import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIsDesktop } from '../lib/useMediaQuery';
import { BrandMark } from '../components/BrandMark';
import { DesktopShell } from '../components/DesktopShell';
import { MobileNavSheet } from '../components/MobileNavSheet';

const CONTACT_EMAIL = 'contact@ranjitpandey.dev';
const SOURCE_URL = 'https://github.com/ranjitp16/locate-my-bus';
const LAST_UPDATED = 'May 2026';

export default function AboutPage() {
  const isDesktop = useIsDesktop();
  useEffect(() => {
    const prev = document.title;
    document.title = 'About — Locate My Bus';
    // Reset scroll on mount: visitors typically click "About" from the bottom
    // of Landing, and React Router preserves that offset on navigation.
    window.scrollTo(0, 0);
    return () => {
      document.title = prev;
    };
  }, []);
  return isDesktop ? <DesktopAbout /> : <MobileAbout />;
}

function DesktopAbout() {
  return (
    <DesktopShell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '56px 32px 64px' }}>
        <AboutBody />
      </div>
    </DesktopShell>
  );
}

function MobileAbout() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 60 }}>
        <div
          style={{
            padding: '24px 20px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <BrandMark />
          <MobileNavSheet />
        </div>
        <div style={{ padding: '24px 20px 0' }}>
          <AboutBody />
        </div>
      </div>
    </div>
  );
}

function AboutBody() {
  return (
    <>
      <div
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 14,
        }}
      >
        About · Terms · Privacy
      </div>

      <h1
        className="display"
        style={{
          fontSize: 44,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: -1.4,
          color: 'var(--text)',
          marginBottom: 28,
        }}
      >
        The fine print.
      </h1>

      <Section title="What this is">
        <p>
          Locate My Bus is a free, ad-free side project that shows live bus
          positions on a map. It reads the public{' '}
          <strong style={emphasisStyle}>GTFS-Realtime</strong> vehicle position
          feeds that transit agencies already publish, and refreshes them every
          15 seconds. No accounts. No ads. No selling your data.
        </p>
      </Section>

      <Section title="Not affiliated with any transit agency">
        <p>
          This site is built and run by Ranjit Pandey as a personal project. It
          is{' '}
          <strong style={emphasisStyle}>
            not affiliated with, endorsed by, or operated by
          </strong>{' '}
          Halifax Transit or any of the other agencies whose data appears here.
          Transit data remains the property of the respective agency and is used
          under that agency's open-data licence; attribution belongs to them.
        </p>
      </Section>

      <Section title="Accuracy — please read">
        <p>
          Bus positions come straight from each agency's feed. When the feed
          lags, drops a vehicle, or shows a trip as "scheduled" when it has
          actually been cancelled, you'll see the same thing here. Treat
          positions as a guide, not a guarantee — leave a buffer for the bus you
          actually want to catch. Don't blame the driver or the agency if a feed
          gap makes a bus disappear from the map; and please don't blame me
          either.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          No login, no account, and no personal profile collected by this site.
          Google Analytics counts anonymous page visits. GA may set first-party
          cookies (such as <code style={codeStyle}>_ga</code>) in your browser
          so it can tell repeat visitors apart; clearing site data removes them.
          GA receives the page URL, referrer, and your IP, which Google uses to
          estimate region and then drops (see Google's GA privacy policy). This
          site itself does not store your IP.
        </p>
        <p style={{ marginTop: 10 }}>
          <strong style={emphasisStyle}>Location:</strong> if you opt in to
          features that need your position (finding the nearest bus, walking
          directions from where you are), your browser prompts you and the
          coordinates are sent to Azure Maps through this site's server proxy,
          used to compute the result, then dropped. No location history is kept.
          If you don't grant location permission, those features simply do not
          run.
        </p>
        <p style={{ marginTop: 10 }}>
          Your browser stores a small number of UI preferences locally, things
          like theme, the last agency / route you picked, when we last showed
          the donation prompt, and the dashboard access key if you've used the
          admin pages. Clearing site data removes them. The preferences notice
          on the home page does not persist a "yes" anywhere; it auto-dismisses
          after a few seconds and shows again on the next visit.
        </p>
        <p style={{ marginTop: 10 }}>
          <strong style={emphasisStyle}>Third-party assets:</strong> the support
          modal loads a small Buy Me a Coffee logo from{' '}
          <code style={codeStyle}>cdn.buymeacoffee.com</code>, so opening that
          modal makes one image request to their CDN. The "Buy me a coffee" link
          itself takes you to buymeacoffee.com, which has its own privacy policy.
          Map tiles for the live map are proxied through this site so Microsoft
          Azure Maps never sees your subscription key or a direct request from
          your browser.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Bugs, agency onboarding requests, or anything else:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
            {CONTACT_EMAIL}
          </a>
          . Source code is MIT-licensed on{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            GitHub
          </a>
          .
        </p>
      </Section>

      <div
        style={{
          marginTop: 36,
          paddingTop: 18,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-muted)',
        }}
      >
        <span>Last updated {LAST_UPDATED}</span>
        <Link to="/" style={{ color: 'var(--text-soft)', textDecoration: 'none' }}>
          ← Back home
        </Link>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        className="display"
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: -0.3,
          color: 'var(--text)',
          marginBottom: 10,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: 'var(--text-soft)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {children}
      </div>
    </section>
  );
}

const linkStyle: CSSProperties = {
  color: 'var(--signal)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

const emphasisStyle: CSSProperties = { color: 'var(--text)' };

const codeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.92em',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--text)',
};
