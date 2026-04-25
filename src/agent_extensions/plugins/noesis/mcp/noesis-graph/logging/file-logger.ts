import { type LoggerService, type LogLevel } from "@nestjs/common";
import { createWriteStream, mkdirSync, type WriteStream } from "fs";
import { dirname, resolve } from "path";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export class FileLogger implements LoggerService {
  private readonly logPath: string;
  private readonly stream: WriteStream;

  constructor(dataDir: string) {
    this.logPath = resolve(dataDir, "noesis.log");
    mkdirSync(dirname(this.logPath), { recursive: true, mode: DIR_MODE });
    this.stream = createWriteStream(this.logPath, {
      flags: "a",
      mode: FILE_MODE,
    });
    this.stream.on("error", () => {
      // Ignore write failures to avoid cascading errors
    });
  }

  debug(message: string, context?: string): void {
    this.write("DEBUG", message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.write("ERROR", message, context);
    if (trace) {
      this.append(`  ${trace}\n`);
    }
  }

  fatal(message: string, trace?: string, context?: string): void {
    this.write("FATAL", message, context);
    if (trace) {
      this.append(`  ${trace}\n`);
    }
  }

  log(message: string, context?: string): void {
    this.write("LOG", message, context);
  }

  verbose(message: string, context?: string): void {
    this.write("VERBOSE", message, context);
  }

  warn(message: string, context?: string): void {
    this.write("WARN", message, context);
  }

  setLogLevels(_levels: LogLevel[]): void {}

  private write(level: string, message: string, context?: string): void {
    const timestamp = new Date().toISOString();
    const ctx = context ? `[${context}] ` : "";
    this.append(`${timestamp} ${level.padEnd(7)} ${ctx}${message}\n`);
  }

  private append(text: string): void {
    this.stream.write(text);
  }
}
