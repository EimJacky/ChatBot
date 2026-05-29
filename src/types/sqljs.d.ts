declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface Database {
    run(sql: string, params?: BindParams): Database;
    exec(sql: string, params?: BindParams): QueryExecResult[];
    prepare(sql: string, params?: BindParams): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: BindParams): boolean;
    run(params?: BindParams): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export type BindParams = unknown[] | Record<string, unknown>;

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
