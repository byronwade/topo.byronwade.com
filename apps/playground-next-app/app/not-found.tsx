import Link from "next/link";

export default function NotFound() {
  return <main className="playground-shell" data-topo-screen="app-not-found"><section className="playground-content"><p className="playground-kicker">404 / not found</p><h1>This route folded away.</h1><p className="playground-lede">The Topo scanner records this as a not-found state.</p><Link className="playground-button primary" href="/">Return home</Link></section></main>;
}
