import { apiError } from "@/lib/http";

/**
 * Anything under /api (and /v1/..., /v2/..., which map here) that has no route: a JSON 404 that
 * points to the current version, instead of an HTML page or a framework error.
 */
function notFound(req: Request) {
  const path = new URL(req.url).pathname.replace(/^\/api/, "");
  const version = /^\/v\d+\//.test(path) ? path.split("/")[1] : null;
  return apiError(
    "not_found",
    version && version !== "v1"
      ? `API version ${version} doesn't exist. The current version is v1, for example POST /v1/upload.`
      : `There's no API endpoint at ${path}. See /api-docs for the list, for example POST /v1/upload.`,
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
