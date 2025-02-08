import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);

