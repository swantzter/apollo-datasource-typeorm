import { KeyValueCache } from 'apollo-server-caching'
import { EJSON } from 'bson'
import DataLoader from 'dataloader'
import { EntityTarget, getConnection } from 'typeorm'
import { ID, TypeormDataSourceOptions } from './datasource'

// https://github.com/graphql/dataloader#batch-function
const orderDocs = <V>(ids: readonly ID[], idColumn: string) => (
  docs: Array<V | undefined>,
  keyFn?: (source: V) => string | number
) => {
  const keyFnDef =
    keyFn ??
    ((source: V) => {
      if ((source as any)[idColumn]) return (source as any)[idColumn]
      throw new Error(
        'Could not find ID for object; if using an alternate key, pass in a key function'
      )
    })

  const checkNotUndefined = (input: V | undefined): input is V => {
    return Boolean(input)
  }

  const idMap: Map<ID, V> = new Map(docs
    .filter(checkNotUndefined)
    .map((record: V) => [keyFnDef(record), record])
  )
  return ids.map((id) => idMap.get(id) ?? Error('Could not find ID for object; if using an alternate key, pass in a key function'))
}

export interface createCatchingMethodArgs<DType> {
  entity: EntityTarget<DType>
  cache: KeyValueCache
  options: TypeormDataSourceOptions
}

export interface FindArgs {
  ttl?: number
}

export interface CachedMethods<DType> {
  findOneById: (id: ID, args?: FindArgs) => Promise<DType | undefined>
  findManyByIds: (
    ids: ID[],
    args?: FindArgs
  ) => Promise<Array<DType | undefined>>
  deleteFromCacheById: (id: ID) => Promise<void>
  dataLoader?: DataLoader<ID, DType, string>
  cache?: KeyValueCache
  cachePrefix?: string
  primeLoader: (item: DType | DType[], ttl?: number) => void
}

export const createCachingMethods = <DType>({
  entity,
  cache,
  options
}: createCatchingMethodArgs<DType>): CachedMethods<DType> => {
  const getRepo = () => getConnection(options.connectionName).getRepository(entity)
  const getIdColumn = () => getRepo().metadata.primaryColumns[0].propertyName

  const loader = new DataLoader<ID, DType>(async (ids) => {
    const results = await getRepo().findByIds([...ids])
    options?.logger?.debug(
      `TypeormDataSource/DataLoader: response count: ${results.length}`
    )

    return orderDocs<DType>(ids, getIdColumn())(results)
  })

  const cachePrefix = `typeorm-${(entity as any).name}`

  const methods: CachedMethods<DType> = {
    findOneById: async (id, { ttl } = {}) => {
      options?.logger?.debug(`TypeormDataSource: Running query for ID ${id}`)
      const key = `${cachePrefix}${id}`

      const cacheDoc = await cache.get(key)
      if (cacheDoc) {
        return getRepo().create(EJSON.parse(cacheDoc) as DType)
      }

      const doc = await loader.load(id)

      if (Number.isInteger(ttl)) {
        await cache.set(key, EJSON.stringify(doc), { ttl })
      }

      return doc
    },

    findManyByIds: async (ids, args = {}) => {
      options?.logger?.debug(`TypeormDataSource: Running query for IDs ${ids}`)
      return await Promise.all(ids.map(async (id) => await methods.findOneById(id, args)))
    },

    deleteFromCacheById: async (id) => {
      loader.clear(id)
      await cache.delete(`${cachePrefix}${id}`)
    },
    /**
     * Loads an item or items into DataLoader and optionally the cache (if TTL is specified)
     * Use this when running a query outside of the findOneById/findManyByIds methods
     * that automatically and transparently do this
     */
    primeLoader: async (entities, ttl?: number) => {
      entities = Array.isArray(entities) ? entities : [entities]
      for (const entity of entities) {
        loader.prime((entity as any)[getIdColumn()], entity)
        const key = `${cachePrefix}${(entity as any)[getIdColumn()]}`
        if (!!ttl || !!(await cache.get(key))) {
          await cache.set(key, EJSON.stringify(entity), { ttl })
        }
      }
    },
    dataLoader: loader,
    cache,
    cachePrefix
  }

  return methods
}
