/** Error raised when persisted todo data cannot be read safely. */
export class InvalidTodoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTodoDataError";
  }
}
