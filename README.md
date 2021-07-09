# Apollo DataSource for TypeORM

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![QA](https://github.com/swantzter/apollo-datasource-typeorm/actions/workflows/qa.yml/badge.svg)](https://github.com/swantzter/apollo-datasource-typeorm/actions/workflows/qa.yml)
[![Publish to NPM and GCR](https://github.com/swantzter/apollo-datasource-typeorm/actions/workflows/publish.yml/badge.svg)](https://github.com/swantzter/apollo-datasource-typeorm/actions/workflows/publish.yml)
[![codecov](https://codecov.io/gh/swantzter/apollo-datasource-typeorm/branch/main/graph/badge.svg)](https://codecov.io/gh/swantzter/apollo-datasource-typeorm)

This is a TypeORM DataSource for Apollo GraphQL Servers. It was adapted from the [CosmosDB DataSource](https://github.com/andrejpk/apollo-datasource-cosmosdb)

## Usage

Use by creating a new class extending the `TypeormDataSource`, with the desired entity type.
Use separate DataSources for each entity type. Initialise the class
by passing an entity repository created by the TypeORM library.

```typescript
@Entity()
export class UserEntity {
  @PrimaryGeneratedColumn('increment')
  id: number

  @Column({ nullable: true })
  name: string
}

@Entity()
export class PostEntity {
  @PrimaryGeneratedColumn('increment')
  id: number

  @Column({ nullable: true })
  name: string
}

export class UserDataSource extends TypeormDataStore<UserEntity, ApolloContext> {}
export class PostsDataSource extends TypeormDataStore<PostEntity, ApolloContext> {}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  dataSources: () => ({
    users: new UserDataSource(getConnection().getRepository(UserEntity)),
    posts: new PostsDataSource(getConnection().getRepository(PostEntity))
  })
})
```

## Custom queries

TypeormDataSource has a `findByQuery` method that accepts a function taking a
query builder as its only argument, which you can then build a query with.
Can be used in resolvers or to create wrappers.

Example of derived class with custom query methods:

```typescript
export class UserDataSource extends TypeormDataSource<UserEntity, ApolloContext> {
  async findManyByGroupId (groupId: number) {
    return this.findManyByQuery(qb => qb.where('groupId = :groupId', { groupId: 2 }).limit(2))
  }
}
```

## Write Operations

This DataSource has some built-in mutations that can be used to create, update and delete documents.

```typescript
await context.dataSources.users.createOne(userDoc)

await context.dataSources.users.updateOne(userDoc)

await context.dataSources.users.updateOnePartial(userId, { name: 'Bob' })

await context.dataSources.users.deleteOne(userId)
```

## Batching

Batching is provided on all id-based queries by DataLoader.

## Caching

Caching is available on an opt-in basis by passing a `ttl` option on queries.
