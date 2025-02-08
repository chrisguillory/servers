import { z } from "zod";
import { githubRequest } from "../common/utils.js";
import {
  GitHubContentSchema,
  GitHubAuthorSchema,
  GitHubTreeSchema,
  GitHubCommitSchema,
  GitHubReferenceSchema,
  GitHubFileContentSchema,
} from "../common/types.js";

// Schema definitions
export const FileOperationSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const CreateOrUpdateFileSchema = z.object({
  owner: z.string().describe("Repository owner (username or organization)"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("Path where to create/update the file"),
  content: z.string().optional().describe("Content of the file"),
  published_artifact_url: z.string().optional().describe("Public URL of a published artifact containing the file content in a single <code> block"),
  message: z.string().describe("Commit message"),
  branch: z.string().describe("Branch to create/update the file in"),
  sha: z.string().optional().describe("SHA of the file being replaced (required when updating existing files)"),
})
    .refine(
        (data: z.infer<typeof CreateOrUpdateFileSchema>) =>
            data.content !== undefined || data.published_artifact_url !== undefined,
        {
          message: "Either 'content' or 'published_artifact_url' must be provided",
          path: ["content", "published_artifact_url"]
        }
    )
    .refine(
        (data: z.infer<typeof CreateOrUpdateFileSchema>) =>
            !(data.content !== undefined && data.published_artifact_url !== undefined),
        {
          message: "Only one of 'content' or 'published_artifact_url' can be provided",
          path: ["content", "published_artifact_url"]
        }
    );

export const GetFileContentsSchema = z.object({
  owner: z.string().describe("Repository owner (username or organization)"),
  repo: z.string().describe("Repository name"),
  path: z.string().describe("Path to the file or directory"),
  branch: z.string().optional().describe("Branch to get contents from"),
});

export const PushFilesSchema = z.object({
  owner: z.string().describe("Repository owner (username or organization)"),
  repo: z.string().describe("Repository name"),
  branch: z.string().describe("Branch to push to (e.g., 'main' or 'master')"),
  files: z.array(FileOperationSchema).describe("Array of files to push"),
  message: z.string().describe("Commit message"),
});

export const GitHubCreateUpdateFileResponseSchema = z.object({
  content: GitHubFileContentSchema.nullable(),
  commit: z.object({
    sha: z.string(),
    node_id: z.string(),
    url: z.string(),
    html_url: z.string(),
    author: GitHubAuthorSchema,
    committer: GitHubAuthorSchema,
    message: z.string(),
    tree: z.object({
      sha: z.string(),
      url: z.string(),
    }),
    parents: z.array(
      z.object({
        sha: z.string(),
        url: z.string(),
        html_url: z.string(),
      })
    ),
  }),
});

// Type exports
export type FileOperation = z.infer<typeof FileOperationSchema>;
export type GitHubCreateUpdateFileResponse = z.infer<typeof GitHubCreateUpdateFileResponseSchema>;

// Function implementations
export async function getFileContents(
  owner: string,
  repo: string,
  path: string,
  branch?: string
) {
  let url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  if (branch) {
    url += `?ref=${branch}`;
  }

  const response = await githubRequest(url);
  const data = GitHubContentSchema.parse(response);

  // If it's a file, decode the content
  if (!Array.isArray(data) && data.content) {
    data.content = Buffer.from(data.content, "base64").toString("utf8");
  }

  return data;
}

function decodeHTMLEntities(str: string): string {
  const entities: Record<string, string> = {
    '&quot;': '"',
    '&amp;': '&',
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&#x27;': "'",
    // Add more entities as needed
  };
  return str.replace(/&[a-zA-Z0-9#]+;/g, (match) => entities[match] || match);
}

export async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  published_artifact_url: string,
  message: string,
  branch: string,
  sha?: string
) {
  let fileContent: string;

  if (content !== undefined) {
    fileContent = content;
  } else if (published_artifact_url !== undefined) {
    // Fetch the content from the published artifact URL
    const response = await fetch(published_artifact_url);
    const html = await response.text();
    const codeBlockRegex = /<code[^>]*?>(.*?)<\/code>/s; // Regex to match one <code> tag
    const match = html.match(codeBlockRegex);

    if (!match) {
      throw new Error("Could not find a singular <code> block in the published artifact");
    }

    const decodedContent = decodeHTMLEntities(match[1]);
    fileContent = decodedContent;
  } else {
    throw new Error("Either 'content' or 'published_artifact_url' must be provided");
  }
  const encodedContent = Buffer.from(fileContent).toString("base64");

  let currentSha = sha;
  if (!currentSha) {
    try {
      const existingFile = await getFileContents(owner, repo, path, branch);
      if (!Array.isArray(existingFile)) {
        currentSha = existingFile.sha;
      }
    } catch (error) {
      console.error("Note: File does not exist in branch, will create new file");
    }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message,
    content: encodedContent,
    branch,
    ...(currentSha ? { sha: currentSha } : {}),
  };

  const response = await githubRequest(url, {
    method: "PUT",
    body,
  });

  return GitHubCreateUpdateFileResponseSchema.parse(response);
}

async function createTree(
  owner: string,
  repo: string,
  files: FileOperation[],
  baseTree?: string
) {
  const tree = files.map((file) => ({
    path: file.path,
    mode: "100644" as const,
    type: "blob" as const,
    content: file.content,
  }));

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      body: {
        tree,
        base_tree: baseTree,
      },
    }
  );

  return GitHubTreeSchema.parse(response);
}

async function createCommit(
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[]
) {
  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      body: {
        message,
        tree,
        parents,
      },
    }
  );

  return GitHubCommitSchema.parse(response);
}

async function updateReference(
  owner: string,
  repo: string,
  ref: string,
  sha: string
) {
  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/${ref}`,
    {
      method: "PATCH",
      body: {
        sha,
        force: true,
      },
    }
  );

  return GitHubReferenceSchema.parse(response);
}

export async function pushFiles(
  owner: string,
  repo: string,
  branch: string,
  files: FileOperation[],
  message: string
) {
  const refResponse = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`
  );

  const ref = GitHubReferenceSchema.parse(refResponse);
  const commitSha = ref.object.sha;

  const tree = await createTree(owner, repo, files, commitSha);
  const commit = await createCommit(owner, repo, message, tree.sha, [commitSha]);
  return await updateReference(owner, repo, `heads/${branch}`, commit.sha);
}
