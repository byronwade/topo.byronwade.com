import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function docsHref(href: string | undefined): string | undefined {
  if (!href || href.startsWith("http") || href.startsWith("#")) return href;
  const [target, anchor] = href.split("#", 2);
  if (!target?.endsWith(".md")) return href;
  const slug = target.split("/").at(-1)?.replace(/\.md$/i, "").toLowerCase();
  return slug ? `/docs/${slug}${anchor ? `#${anchor}` : ""}` : href;
}

export function MarkdownArticle({ content }: { content: string }) {
  return (
    <article className="markdown-article">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const mapped = docsHref(href);
            if (mapped?.startsWith("/")) {
              return <Link href={mapped}>{children}</Link>;
            }
            return (
              <a href={mapped} {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
