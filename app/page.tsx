import { SubscribeForm } from "@/app/subscribe-form";
import { subscribeAction } from "@/app/subscribe-actions";

export default function HomePage() {
  return (
    <main className="page">
      <div className="backdrop" aria-hidden />
      <p className="eyebrow">UMD Dining Digest</p>
      <h1>Daily Dining Highlights</h1>
      <p className="section-copy">
        Subscribe to receive curated UMD dining picks with specials and high-interest items grouped by hall
        and meal.
      </p>
      <section className="card signup-card">
        <SubscribeForm action={subscribeAction} />
      </section>
      <footer className="footer">
        <a className="footerLink" href="https://arjun.systems" target="_blank" rel="noreferrer">
          <img
            className="footerIcon footerIconLarge"
            src="/systems%20site%20icon.png"
            alt="Arjun Systems"
            width={26}
            height={26}
            loading="lazy"
          />
          <span className="footerLinkText">arjun.systems</span>
        </a>
        <span className="footerDivider">//</span>
        <a className="footerLink" href="https://arjuniyer.dev" target="_blank" rel="noreferrer">
          <img
            className="footerIcon"
            src="/personal%20site%20icon.png"
            alt="Arjun Iyer"
            width={20}
            height={20}
            loading="lazy"
          />
          <span className="footerLinkText">arjuniyer.dev</span>
        </a>
      </footer>
    </main>
  );
}
