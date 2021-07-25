import { DataSource, DataSourceConfig } from 'apollo-datasource'
import { ApolloError } from 'apollo-server-errors'
import { InMemoryLRUCache } from 'apollo-server-caching'

import { Logger } from './helpers'
import { createCachingMethods, CachedMethods, FindArgs } from './cache'
import { DeepPartial, EntityTarget, FindConditions, getConnection, ObjectID, SelectQueryBuilder } from 'typeorm'
import { EntityFieldsNames } from 'typeorm/common/EntityFieldsNames'

export interface TypeormDataSourceOptions {
  logger?: Logger
  connectionName?: string
}

export type ID = string | number | Date | ObjectID

const placeholderHandler = () => {
  throw new Error('DataSource not initialized')
}

export type QueryFindArgs<TEntity> = FindArgs & {
  order?: Partial<Record<EntityFieldsNames<TEntity>, 'ASC' | 'DESC' | 1 | -1>>
  withDeleted?: boolean
}

export class TypeormDataSource<TEntity, TContext>
  extends DataSource<TContext>
  implements CachedMethods<TEntity> {
  context?: TContext
  options: TypeormDataSourceOptions
  entity: EntityTarget<TEntity>
  // these get set by the initializer but they must be defined or nullable after the constructor
  // runs, so we guard against using them before init
  findOneById: CachedMethods<TEntity>['findOneById'] = placeholderHandler
  findManyByIds: CachedMethods<TEntity>['findManyByIds'] = placeholderHandler
  deleteFromCacheById: CachedMethods<TEntity>['deleteFromCacheById'] = placeholderHandler
  primeLoader: CachedMethods<TEntity>['primeLoader'] = placeholderHandler
  dataLoader: CachedMethods<TEntity>['dataLoader']
  cache: CachedMethods<TEntity>['cache']
  cachePrefix: CachedMethods<TEntity>['cachePrefix']

  async findManyByQuery (
    queryFunction: (qb: SelectQueryBuilder<TEntity>) => SelectQueryBuilder<TEntity>,
    { ttl }: FindArgs = {}
  ) {
    const qb = getConnection(this.options.connectionName).getRepository(this.entity).createQueryBuilder()
    const results = await queryFunction(qb).getMany()
    // prime these into the dataloader and maybe the cache
    this.primeLoader(results, ttl)
    this.options?.logger?.info(`TypeormDataSource/findManyByQuery: complete. rows: ${results.length}`)
    return results
  }

  async findManyWhere (where: FindConditions<TEntity>, { ttl, order, withDeleted }: QueryFindArgs<TEntity> = {}) {
    this.options?.logger?.debug(`TypeormDataSource/findManyWhere: Running query where ${JSON.stringify(where)}`)
    const results = await this.repo.find({ where, order, withDeleted })
    this.primeLoader(results, ttl)
    this.options?.logger?.info(`TypeormDataSource/findManyWhere: complete. rows: ${results.length}`)
    return results
  }

  async createOne (newEntity: DeepPartial<TEntity> | TEntity, { ttl }: FindArgs = {}) {
    if (this.idColumn in newEntity) {
      return await this.updateOne(newEntity as TEntity)
    } else {
      const entity = this.repo.create(newEntity as DeepPartial<TEntity>)
      const result = await this.repo.save(entity)
      if (result) {
        this.primeLoader(result, ttl)
      }
      return result
    }
  }

  async deleteOne (id: ID, { hard }: { hard?: boolean } = {}) {
    this.options?.logger?.info(
      `TypeormDataSource/deleteOne: deleting id: '${id}'`
    )
    const entity = await this.repo.findOne(id)
    if (!entity) throw new ApolloError('Cannot remove, entity does not exist')
    const response = await (hard ? this.repo.remove(entity) : this.repo.softRemove(entity))
    await this.deleteFromCacheById(id)
    return response
  }

  async updateOne (data: TEntity) {
    const result = await this.repo.save(data)
    this.primeLoader(result)
    return result
  }

  async updateOnePartial (id: ID, data: DeepPartial<TEntity>) {
    this.options?.logger?.debug(
      `TypeormDataSource/updateOnePartial: Updating doc id ${id} contents: ${JSON.stringify(data, null, '')}`
    )
    const { [this.idColumn]: _id, ...cleanData } = data as any
    const found = await this.repo.findOne(id)
    if (!found) throw new ApolloError('COuld not find entity to update')

    const result = await this.repo.save(this.repo.merge(found, cleanData))
    this.primeLoader(result)
    return result
  }

  constructor (entity: EntityTarget<TEntity>, options: TypeormDataSourceOptions = {}) {
    super()
    options?.logger?.info('TypeormDataSource started')

    this.options = options
    this.entity = entity
  }

  private get repo () {
    return getConnection(this.options.connectionName).getRepository(this.entity)
  }

  private get idColumn () {
    if (this.repo.metadata.hasMultiplePrimaryKeys) {
      throw new ApolloError('TypeormDataSource currently doesn\'t support entities with multiple primary keys')
    }
    return this.repo.metadata.primaryColumns[0].propertyName
  }

  initialize ({
    context,
    cache
  }: DataSourceConfig<TContext>) {
    this.context = context

    const methods = createCachingMethods<TEntity>({
      entity: this.entity,
      cache: cache ?? new InMemoryLRUCache(),
      options: this.options
    })

    Object.assign(this, methods)
  }
}
