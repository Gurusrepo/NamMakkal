export const version = '034_account_archival';

export function up(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.some((column) => column.name === 'deleted_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role_status_deleted
    ON users(role, account_status, deleted_at, id)`);
}
