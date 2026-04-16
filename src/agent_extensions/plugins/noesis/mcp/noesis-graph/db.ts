import lbug from "lbug";

const { Database, Connection } = lbug;

type LbugDatabase = InstanceType<typeof Database>;
type LbugConnection = InstanceType<typeof Connection>;

let database: LbugDatabase | null = null;
let connection: LbugConnection | null = null;

export function initDatabase(dataDir: string): LbugConnection {
  const dbPath = `${dataDir}/ladybug-db`;
  database = new Database(dbPath);
  connection = new Connection(database);
  return connection;
}

export function getConnection(): LbugConnection {
  if (connection === null) {
    throw new Error("Database not initialized. Call initDatabase first.");
  }
  return connection;
}

export async function closeDatabase(): Promise<void> {
  connection = null;
  if (database !== null) {
    await database.close();
    database = null;
  }
}
