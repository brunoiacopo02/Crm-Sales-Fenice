/**
 * One-shot: aggiunge `companyId` text default 'fenice' references companies.id
 * a tutti i pgTable() in src/db/schema.ts, esclusi i tavoli in SKIP.
 *
 * Mantiene formatting esistente. Idempotente: se la riga companyId è già
 * presente in una tabella, la salta.
 *
 * Run: npx tsx scripts/addCompanyIdToSchema.ts
 */
import { Project, SyntaxKind } from 'ts-morph';
import * as path from 'node:path';

const SCHEMA_PATH = path.resolve(process.cwd(), 'src/db/schema.ts');

// Tavoli da NON modificare:
//   - users         → companyId già aggiunto in 0005 (manualmente, con altre colonne)
//   - companies     → è la tabella tenant stessa, ovviamente skip
//   - creatures     → catalogo gamification globale (decisione Bruno 2026-05-21)
//   - marketingWebhookDeliveries → sarà droppato in M5 fase 3
const SKIP_TABLES = new Set(['users', 'companies', 'creatures', 'marketingWebhookDeliveries']);

const COMPANY_ID_LINE = `    companyId: text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' }),`;

function main() {
    const project = new Project({ tsConfigFilePath: path.resolve(process.cwd(), 'tsconfig.json') });
    const sourceFile = project.addSourceFileAtPath(SCHEMA_PATH);

    let modifiedCount = 0;
    let skippedCount = 0;
    let alreadyHadCount = 0;

    // Trova tutti i `export const X = pgTable('X', { ... }, ...)` calls.
    const variableStatements = sourceFile.getVariableStatements();
    for (const stmt of variableStatements) {
        for (const decl of stmt.getDeclarations()) {
            const initializer = decl.getInitializer();
            if (!initializer) continue;
            if (initializer.getKind() !== SyntaxKind.CallExpression) continue;

            const callExpr = initializer.asKindOrThrow(SyntaxKind.CallExpression);
            const expression = callExpr.getExpression();
            if (expression.getText() !== 'pgTable') continue;

            const args = callExpr.getArguments();
            if (args.length < 2) continue;

            // Primo arg: nome tabella stringa literal
            const firstArg = args[0];
            if (firstArg.getKind() !== SyntaxKind.StringLiteral) continue;
            const tableName = firstArg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();

            if (SKIP_TABLES.has(tableName)) {
                console.log(`  SKIP    ${tableName}`);
                skippedCount++;
                continue;
            }

            // Secondo arg: object literal { col1: ..., col2: ..., }
            const columnsArg = args[1];
            if (columnsArg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
            const obj = columnsArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

            // Check idempotenza: se esiste già una property 'companyId', skippa
            const hasCompanyId = obj.getProperties().some(p => {
                const propText = p.getText();
                return /^\s*companyId\s*:/.test(propText) || /companyId:/.test(propText.split('\n')[0]);
            });
            if (hasCompanyId) {
                console.log(`  HAS_ALREADY ${tableName}`);
                alreadyHadCount++;
                continue;
            }

            // Inserisci companyId come ultima property dell'object literal.
            // ts-morph gestisce la virgola separatrice automaticamente.
            obj.addPropertyAssignment({
                name: 'companyId',
                initializer: `text('companyId').default('fenice').notNull().references(() => companies.id, { onUpdate: 'cascade' })`,
            });

            console.log(`  ADDED   ${tableName}`);
            modifiedCount++;
        }
    }

    sourceFile.saveSync();

    console.log(`\nDone:`);
    console.log(`  Modified: ${modifiedCount}`);
    console.log(`  Skipped:  ${skippedCount}`);
    console.log(`  Already:  ${alreadyHadCount}`);
}

main();
