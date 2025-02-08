import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";

const server = new McpServer({
    name: "postgres2",
    version: "1.0.0",
});

server.tool(
    "query",
    "Run a read-only SQL query",
    {
        query: z.string().describe("SQL query to run"),
    },
    async ({query}) => {
        const {Pool} = await import("pg");
        const pool = new Pool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN TRANSACTION READ ONLY");
            const result = await client.query(query);
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