import { type LoggerService, type LogLevel } from "@nestjs/common";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

export class FileLogger implements LoggerService {
  private readonly logPath: string;

  constructor(dataDir: string) {
    this.logPath = resolve(dataDir, "noesis.log");
    mkdirSync(dirname(this.logPath), { recursive: true });
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
    try {
      appendFileSync(this.logPath, text);
    } catch {
      // Ignore write failures to avoid cascading errors
    }
  }
}
