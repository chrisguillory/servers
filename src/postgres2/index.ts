// noinspection SqlNoDataSourceInspection

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ResourceTemplate} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import pg from "pg";

const server = new McpServer({
    name: "postgres2",
    version: "1.0.0",
});

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Please provide a database URL as a command-line argument");
    process.exit(1);
}

const databaseUrl = args[0];

const resourceBaseUrl = new URL(databaseUrl);
resourceBaseUrl.protocol = "postgres:";
resourceBaseUrl.password = "";

const pool = new pg.Pool({
    connectionString: databaseUrl,
});

server.tool(
    "query",
    "Run a read-only SQL query",
    {
        sql: z.string().describe("SQL query to run"),
    },
    async ({sql}) => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN TRANSACTION READ ONLY");
            const result = await client.query(sql);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result.rows, null, 2),
                    },
                ],
            };
        } finally {
            client
                .query("ROLLBACK")
                .catch((error) =>
                    console.warn("Could not roll back transaction:", error),
                );

            client.release();
        }
    },
)

server.resource(
    "tableSchema",
    new ResourceTemplate("postgres://{host}/{table}/schema", {
        // List handler returns all available tables
        list: async () => {
            const client = await pool.connect();
            try {

                const result = await client.query(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
                );
                return {
                    resources: result.rows.map((row) => ({
                        uri: new URL(`${row.table_name}/schema`, resourceBaseUrl).href,
                        mimeType: "application/json",
                        name: `"${row.table_name}" database schema`,
                    }))
                };
            } finally {
                client.release();
            }
        }
    }),
    // Read handler for individual table schemas
    async (uri, {table}) => {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT column_name,
                       data_type,
                       is_nullable,
                       column_default,
                       character_maximum_length,
                       numeric_precision,
                       numeric_scale
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = $1
                ORDER BY ordinal_position
            `, [table]);

            if (result.rows.length === 0) {
                throw new Error(`Table "${table}" not found`);
            }

            const schema = {
                type: "object",
                properties: Object.fromEntries(
                    result.rows.map(row => [
                        row.column_name,
                        {
                            type: row.data_type,
                            nullable: row.is_nullable === 'YES',
                            default: row.column_default,
                            ...(row.character_maximum_length && {
                                maxLength: row.character_maximum_length
                            }),
                            ...(row.numeric_precision && {
                                precision: row.numeric_precision,
                                scale: row.numeric_scale
                            })
                        }
                    ])
                )
            };

            return {
                contents: [{
                    uri: uri.href,
                    mimeType: "application/json",
                    text: JSON.stringify(schema, null, 2)
                }]
            };
        } finally {
            client.release();
        }
    }
);

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);

