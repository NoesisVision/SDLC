import { Global, Module, type DynamicModule } from "@nestjs/common";

export const DATA_DIR = "DATA_DIR";

@Global()
@Module({})
export class ConfigModule {
  static forRoot(dataDir: string): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: DATA_DIR, useValue: dataDir }],
      exports: [DATA_DIR],
    };
  }
}
