namespace Valour.Server.Utilities;

public static class FrameworkCacheHeaders
{
    /// <summary>
    /// dotnet.js carries the fingerprinted asset list but is not itself
    /// fingerprinted, so a cached copy pins clients to an old build.
    /// </summary>
    public static IApplicationBuilder UseFrameworkCacheHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? string.Empty;

            if (path.EndsWith("/_framework/dotnet.js", StringComparison.OrdinalIgnoreCase)
                || path.EndsWith("/_framework/blazor.webassembly.js", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.OnStarting(() =>
                {
                    context.Response.Headers.CacheControl = "no-cache";
                    return Task.CompletedTask;
                });
            }

            await next();
        });
    }
}
