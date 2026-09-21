export function formatRequestUrl(request: Request): string {
  const url = new URL(request.url);
  const base = `${url.origin}${url.pathname}`;
  const params: string[] = [];
  url.searchParams.forEach((value, key) => {
    params.push(`${key}=${value}`);
  });
  if (!params.length) {
    return base;
  }
  return `${base}\n? ${params.join("\n& ")}`;
}

export async function logRequest(request: Request): Promise<void> {
  console.log(request.method, formatRequestUrl(request));
  const text = await request.clone().text();
  if (text) {
    console.log(text);
  }
}
