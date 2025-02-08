import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";
import type {Request} from "@modelcontextprotocol/sdk/types.js";


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

// List available resources
server.server.setRequestHandler(
    z.object({
        method: z.literal("listResources")
    }), 
    async () => {
      return {
        resources: [
          {
            uri: "file:///logs/app.log",
            name: "Application Logs",
            mimeType: "text/plain"
          }
        ]
      };
    }
);
  
// Read resource contents
server.server.setRequestHandler(
    z.object({
        method: z.literal("readResource"),
        params: z.object({
            uri: z.string()
        })
    }), 
    async (request) => {
      const uri = request.params.uri;
    
      if (uri === "file:///logs/app.log") {
        const logContents = 'Log contents go here';
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: logContents
            }
          ]
        };
      }
    
      throw new Error("Resource not found");
    }
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
