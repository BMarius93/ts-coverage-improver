/** Produces unique identifiers for new aggregates. */
export interface IdGenerator {
  next(): string;
}
