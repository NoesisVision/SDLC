import { Global, Module, type DynamicModule } from "@nestjs/common";

export const DATA_DIR = "DATA_DIR";
export const PROJECT_DIR = "PROJECT_DIR";

@Global()
@Module({})
export class ConfigModule {
  static forRoot(dataDir: string, projectDir: string): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: DATA_DIR, useValue: dataDir },
        { provide: PROJECT_DIR, useValue: projectDir },
      ],
      exports: [DATA_DIR, PROJECT_DIR],
    };
  }
}
