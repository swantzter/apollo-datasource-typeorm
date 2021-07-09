import { Repository } from 'typeorm'

export const isTypeormRepository = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maybeRepository: any
): maybeRepository is Repository<any> => {
  return maybeRepository.find &&
    maybeRepository.findOne &&
    maybeRepository.metadata.target &&
    maybeRepository.metadata.tableName
}

export interface Logger {
  // Ordered from least-severe to most-severe.
  debug: (message?: string) => void
  info: (message?: string) => void
  warn: (message?: string) => void
  error: (message?: string) => void
}
