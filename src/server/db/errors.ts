export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database persistence is unavailable.");
    this.name = "DatabaseUnavailableError";
  }
}
