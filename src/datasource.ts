import { DataSource } from 'apollo-datasource'
import { ApolloError } from 'apollo-server-errors'
import { InMemoryLRUCache, KeyValueCache } from 'apollo-server-caching'

import { isTypeormRepository, Logger } from './helpers'
import { createCachingMethods, CachedMethods, FindArgs } from './cache'
import { DeepPartial, ObjectID, Repository, SelectQueryBuilder } from 'typeorm'

export interface TypeormDataSourceOptions {
  logger?: Logger
}

export type ID = string | number | Date | ObjectID

const placeholderHandler = () => {
  throw new Error('DataSource not initialized')
}

export type QueryFindArgs = FindArgs

export class TypeormDataSource<TEntity, TContext>
  extends DataSource<TContext>
  implements CachedMethods<TEntity> {
  context?: TContext
  options: TypeormDataSourceOptions
  repo: Repository<TEntity>
  idColumn: string
  // these get set by the initializer but they must be defined or nullable after the constructor
  // runs, so we guard against using them before init
  findOneById: CachedMethods<TEntity>['findOneById'] = placeholderHandler
  findManyByIds: CachedMethods<TEntity>['findManyByIds'] = placeholderHandler
  deleteFromCacheById: CachedMethods<TEntity>['deleteFromCacheById'] = placeholderHandler
  primeLoader: CachedMethods<TEntity>['primeLoader'] = placeholderHandler
  dataLoader: CachedMethods<TEntity>['dataLoader']
  cache: CachedMethods<TEntity>['cache']
  cachePrefix: CachedMethods<TEntity>['cachePrefix']

  /**
   *
   * @param query
   * @param options
   */
  async findManyByQuery (
    queryFunction: (qb: SelectQueryBuilder<TEntity>) => SelectQueryBuilder<TEntity>,
    { ttl }: QueryFindArgs = {}
  ) {
    const qb = this.repo.createQueryBuilder()
    const results = await queryFunction(qb).getMany()
    // prime these into the dataloader and maybe the cache
    if (this.dataLoader && results) {
      this.primeLoader(results, ttl)
    }
    this.options?.logger?.info(
      `TypeormDataSource/findManyByQuery: complete. rows: ${results.length}`
    )
    return results
  }

  async createOne (newEntity: DeepPartial<TEntity> | TEntity, { ttl }: QueryFindArgs = {}) {
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
    await this.repo.update((data as any)[this.idColumn], data)

    const result = await this.repo.findOne((data as any)[this.idColumn])
    if (result) {
      this.primeLoader(result)
    }
    return result
  }

  async updateOnePartial (id: ID, data: DeepPartial<TEntity>) {
    this.options?.logger?.debug(
      `TypeormDataSource/updateOnePartial: Updating doc id ${id} contents: ${JSON.stringify(data, null, '')}`
    )
    const { [this.idColumn]: _id, ...cleanData } = data as any
    await this.repo.update(id, cleanData)

    const result = await this.repo.findOne(id)
    if (result) {
      this.primeLoader(result)
    }
    return result
  }

  constructor (repo: Repository<TEntity>, options: TypeormDataSourceOptions = {}) {
    super()
    options?.logger?.info('TypeormDataSource started')

    if (!isTypeormRepository(repo)) {
      throw new ApolloError(
        'TypeormDataSource must be created with a TypeORM repository'
      )
    }
    if (repo.metadata.hasMultiplePrimaryKeys) {
      throw new ApolloError('TypeormDataSource currently doesn\'t support entities with multiple primary keys')
    }

    this.options = options
    this.repo = repo
    this.idColumn = repo.metadata.primaryColumns[0].propertyName
  }

  initialize ({
    context,
    cache
  }: { context?: TContext, cache?: KeyValueCache } = {}) {
    this.context = context

    const methods = createCachingMethods<TEntity>({
      repo: this.repo,
      cache: cache ?? new InMemoryLRUCache(),
      options: this.options
    })

    Object.assign(this, methods)
  }
}
