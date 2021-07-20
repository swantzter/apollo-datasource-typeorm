/* eslint-env mocha */
import { createConnection, getConnection, Repository } from 'typeorm'
import assert from 'assert'

import { TypeormDataSource } from '../src'
import { UserEntity } from './entity/user'
import { InMemoryLRUCache } from 'apollo-server-caching'

type Context = null

class UserDataSource extends TypeormDataSource<UserEntity, Context> {}

let userSource: UserDataSource

describe('TypeormDataSource', () => {
  before(async () => {
    await createConnection({
      type: 'mysql',
      host: process.env.DB_HOST ?? 'db',
      port: 3306,
      username: 'root',
      password: 'mysql_strong_password',
      database: 'test',
      synchronize: true,
      logging: false,
      entities: [
        UserEntity
      ]
    })
  })

  beforeEach(() => {
    const connection = getConnection()
    userSource = new UserDataSource(connection.getRepository(UserEntity))
    userSource.initialize({ context: null, cache: new InMemoryLRUCache() })
  })

  afterEach(async () => {
    const connection = getConnection()
    await connection.getRepository(UserEntity).clear()
  })

  it('Should throw if not given a typeorm repository', async () => {
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ = new UserDataSource(true as unknown as Repository<UserEntity>)
    }, err => {
      assert.strictEqual(err.name, 'Error')
      assert.strictEqual(err.message, 'TypeormDataSource must be created with a TypeORM repository')
      return true
    })
  })

  it('Should throw if not called on an initialised instance', async () => {
    assert.throws(() => {
      const connection = getConnection()
      const uninitialised = new UserDataSource(connection.getRepository(UserEntity))
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      uninitialised.findOneById('a') // this isn't a promise
    }, err => {
      assert.strictEqual(err.name, 'Error')
      assert.strictEqual(err.message, 'DataSource not initialized')
      return true
    })
  })

  describe('createOne', () => {
    it('Should create an entity and return it', async () => {
      const newUser = {
        email: 'hello@test.com'
      }
      const data = await userSource.createOne(newUser)
      assert.strictEqual(data.email, newUser.email)
      assert.notStrictEqual(data.id, undefined)
      assert.notStrictEqual(data.createdAt, undefined)
      assert.notStrictEqual(data.updatedAt, undefined)
      assert.strictEqual(data.deletedAt, null)
      assert.strictEqual(data.name, null)
    })

    describe('updateOne', () => {
      it('Should update an entity', async () => {
        const { id: createdId, ...created } = await userSource.createOne({
          email: 'hello@test.com'
        })

        const { id: updatedId, ...updated } = await userSource.updateOne({ id: createdId, ...created, name: 'Test' })

        assert.strictEqual(updatedId, createdId)
        assert.notDeepStrictEqual(updated, created)
      })
    })
  })

  describe('updateOnePartial', () => {
    it('Should partially update an entity', async () => {
      const createData = {
        email: 'hello3@test.com'
      }
      const updateData = {
        name: 'Testson'
      }

      const { id: createdId, ...created } = await userSource.createOne(createData)
      const { id: updatedId, ...updated } = await userSource.updateOnePartial(createdId, updateData)

      assert.strictEqual(updatedId, createdId)
      assert.notStrictEqual(created.updatedAt, updated.updatedAt)
      assert.deepStrictEqual({ name: updated.name, email: updated.email }, { ...createData, ...updateData })
    })

    it('Partial update should update cache', async () => {
      const createData = {
        email: 'hello3@test.com'
      }
      const updateData = {
        name: 'Testson'
      }

      const { id: createdId, ...created } = await userSource.createOne(createData, { ttl: 60 })
      const { id: updatedId } = await userSource.updateOnePartial(createdId, updateData)
      const { id: refetchedId, ...refetched } = await userSource.findOneById(createdId, { ttl: 60 }) as UserEntity

      assert.strictEqual(updatedId, refetchedId)
      assert.deepStrictEqual({ email: refetched.email, name: refetched.name }, { ...createData, ...updateData })
      assert.notDeepStrictEqual(created, refetched, 'created does not match refetched')
    })

    it('Partial update should not be able to change the ID', async () => {
      const createData = {
        email: 'hello3@test.com'
      }
      const updateData = {
        name: 'Testson'
      }

      const { id: createdId } = await userSource.createOne(createData)
      const { id: updatedId, ...updated } = await userSource.updateOnePartial(createdId, { id: Number(createdId) + 1, ...updateData })

      const result = await getConnection().getRepository(UserEntity).findOne(Number(createdId) + 1)
      assert.strictEqual(result, undefined)

      assert.strictEqual(updatedId, createdId)
      assert.deepStrictEqual({ email: updated.email, name: updated.name }, { ...createData, ...updateData })
    })
  })

  describe('deleteOne', () => {
    it('Should delete an entity', async () => {
      const { id: createdId } = await userSource.createOne({
        email: 'hello@test.com'
      })

      await userSource.deleteOne(createdId)

      const result = await getConnection().getRepository(UserEntity).findOne(createdId)
      assert.strictEqual(result, undefined)
    })
  })

  describe('findOneById', () => {
    it('Should find an entity by ID', async () => {
      // make sure we have extra users in the DB
      // also make sure they are created outside of the DataSource
      // as things will be cached on creation
      const repo = getConnection().getRepository(UserEntity)
      const createOne = await repo.save(repo.create({
        email: 'hello@test.com'
      }))

      await repo.save(repo.create({
        email: 'hello22@test.com'
      }))

      const foundOne = await userSource.findOneById(createOne.id)

      assert.deepStrictEqual(foundOne, createOne)
    })

    it('Should cache a found entity', async () => {
      const createdOne = await userSource.createOne({
        email: 'hello@test.com'
      })

      const foundOne = await userSource.findOneById(createdOne.id, { ttl: 1000 })

      // modify db in a way that won't hit the dataSource cache
      await getConnection().getRepository(UserEntity).update(createdOne.id, { email: 'new@test.com' })

      const foundAgain = await userSource.findOneById(createdOne.id, { ttl: 1000 })

      assert.deepStrictEqual(foundOne, foundAgain)
    })
  })

  describe('findManyByIds', () => {
    it('Should find multiple entities by ID', async () => {
      // make sure we have extra users in the DB
      const createdOne = await userSource.createOne({
        email: 'hello@test.com'
      })
      const createdTwo = await userSource.createOne({
        email: 'hello2@test.com'
      })
      await userSource.createOne({
        email: 'hello3@test.com'
      })

      const foundOnes = await userSource.findManyByIds([createdTwo.id, createdOne.id])

      assert.deepStrictEqual(foundOnes, [createdTwo, createdOne])
    })

    it('Should find more than 10 entities by ID', async () => {
      const createPromises: Array<Promise<UserEntity>> = []
      for (let idx = 0; idx < 23; idx++) {
        createPromises.push(userSource.createOne({
          email: `hello${idx}@test.com`
        }))
      }
      const created = await Promise.all(createPromises)
      await Promise.all(created.map(c => userSource.deleteFromCacheById(c.id))) // eslint-disable-line @typescript-eslint/promise-function-async

      const foundOnes = await userSource.findManyByIds(created.map(u => u.id))

      assert.deepStrictEqual(foundOnes, created)
    })
  })

  describe('findManyByQuery', () => {
    it('Should find entities by query on field', async () => {
      // make sure we have extra users in the db, avoid cached methods when creating
      const repo = getConnection().getRepository(UserEntity)
      const email = 'hello@test.com'
      const userOne = {
        email,
        name: 'One'
      }
      const userTwo = {
        email,
        name: 'Two'
      }
      const { id: idOne } = await repo.save(repo.create(userOne))
      const { id: idTwo } = await repo.save(repo.create(userTwo))
      await repo.save(repo.create({
        email: 'other@test.com',
        name: 'Three'
      }))

      const result = await userSource.findManyByQuery(qb => qb.where('email = :email', { email }).orderBy('name'))

      assert.deepStrictEqual(result.map(u => u.id), [idOne, idTwo])
    })
  })
})
