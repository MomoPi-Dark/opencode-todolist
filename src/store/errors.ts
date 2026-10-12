export class InvalidTodoDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTodoDataError";
  }
}
