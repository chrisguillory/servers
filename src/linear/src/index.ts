import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";


const server = new McpServer({
    name: "linear",
    version: "1.0.0",
});


server.tool(
    "add",
    "Add two numbers",
    {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
    },
    ({a, b}) => {
        return {
            content: [
                {
                    type: "text",
                    text: `The sum of ${a} and ${b} is ${a + b}`,
                },
            ],
        };
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Linear MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
