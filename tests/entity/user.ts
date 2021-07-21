import {
  AfterInsert,
  AfterRemove,
  AfterUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm'

@Entity()
export class UserEntity {
  @PrimaryGeneratedColumn('increment')
  id: number

  @Column({ nullable: true })
  name: string

  @Column({ nullable: true })
  email: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  @DeleteDateColumn()
  deletedAt: Date

  #insertHook = false
  #updateHook = false
  #removeHook = false

  get insertHook () { return this.#insertHook }
  get updateHook () { return this.#updateHook }
  get removeHook () { return this.#removeHook }

  @AfterInsert()
  afterInsert () { this.#insertHook = true }

  @AfterUpdate()
  afterUpdate () { this.#updateHook = true }

  @AfterRemove()
  afterRemove () { this.#removeHook = true }
}
