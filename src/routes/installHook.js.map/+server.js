export function GET() {
  // 创建一个最小但有效的 sourcemap
  const sourcemap = {
    version: 3,
    file: "installHook.js",
    sourceRoot: "",
    sources: ["installHook.js"],
    names: [],
    mappings: ""
  };

  return new Response(JSON.stringify(sourcemap), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
} 