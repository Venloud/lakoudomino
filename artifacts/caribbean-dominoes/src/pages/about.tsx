import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'wouter';
import { YardHeader } from './social';
import './about.css';

const credits = [
  {
    title: 'Connect4',
    creator: 'Mayank Singh',
    description: 'Gameplay and board inspiration for Four in a Row. The repository’s code and artwork are not used in 509 Yard.',
    links: [
      { label: 'GitHub project', href: 'https://github.com/bymayanksingh/connect4' },
      { label: 'MIT license', href: 'https://github.com/bymayanksingh/connect4/blob/master/LICENSE' },
    ],
  },
  {
    title: 'Connect4_diag.svg',
    creator: 'Ilmari Karonen',
    description: 'Public-domain visual reference for a diagonal Four in a Row win. The image itself is not included in the game.',
    links: [
      { label: 'Wikimedia Commons file', href: 'https://commons.wikimedia.org/wiki/File:Connect4_diag.svg' },
    ],
  },
  {
    title: 'Playing-cards-assets · Domino set',
    creator: 'safe-acid',
    description: 'The double-six domino tile artwork used in 509 Yard. Released under CC0 1.0 Universal.',
    links: [
      { label: 'GitHub asset pack', href: 'https://github.com/safe-acid/Playing-cards-assets' },
      { label: 'CC0 1.0 license', href: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    ],
  },
  {
    title: 'Mancala · HTML5 reference',
    creator: 'sheabunge',
    description: 'Board and gameplay reference for Kay. No code or artwork from the repository is used.',
    links: [
      { label: 'GitHub project', href: 'https://github.com/sheabunge/mancala' },
    ],
  },
  {
    title: 'Mancala · AI and board variations reference',
    creator: 'HappyHackingOrange',
    description: 'Reference for alternate Mancala board layouts. No code or artwork from the repository is used.',
    links: [
      { label: 'GitHub project', href: 'https://github.com/HappyHackingOrange/Mancala' },
    ],
  },
  {
    title: '2D Chess Pack · Wood pieces',
    creator: 'Screaming Brain Studios',
    description: 'Top-down wood chess-piece sprites used on the Chess board. Released under CC0 1.0 Universal.',
    links: [
      { label: 'CC0 1.0 license', href: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    ],
  },
  {
    title: 'Lila · Lichess',
    creator: 'Lichess contributors',
    description: 'Board feedback and move-history inspiration only. 509 Yard does not use Lila code or artwork. Lila is licensed under AGPL-3.0.',
    links: [
      { label: 'GitHub repository', href: 'https://github.com/lichess-org/lila' },
      { label: 'AGPL-3.0 license', href: 'https://github.com/lichess-org/lila/blob/master/LICENSE' },
    ],
  },
  {
    title: 'Checkers pieces',
    creator: 'VerzatileDev',
    description: 'Assets by VerzatileDev, licensed under CC BY 4.0. Resized for Dame; artwork modified.',
    links: [
      { label: 'Creator page', href: 'https://verzatiledev.itch.io/' },
      { label: 'CC BY 4.0 license', href: 'https://creativecommons.org/licenses/by/4.0/' },
    ],
  },
];

export default function AboutPage() {
  return (
    <div className="yard-app">
      <YardHeader active="about" notifications={0} onLogout={() => {}} />
      <main className="yard-main yard-about-main">
        <Link href="/" className="yard-about-back"><ArrowLeft size={14} /> Home</Link>
        <header className="yard-heading yard-about-heading">
          <div>
            <p className="yard-kicker">509 YARD</p>
            <h1>About & credits</h1>
            <p className="yard-subtitle">Classic games, built with their own look and feel.</p>
          </div>
        </header>

        <section className="yard-about-note">
          References help guide game ideas and interactions. 509 Yard keeps its own visual character; listed projects are inspiration only, not copied code or artwork.
        </section>

        <section className="yard-about-credit-list" aria-label="Sources and credits">
          {credits.map((credit) => (
            <article className="yard-panel yard-about-credit" key={credit.title}>
              <div>
                <p className="yard-kicker">SOURCE</p>
                <h2>{credit.title}</h2>
                <p className="yard-about-creator">By {credit.creator}</p>
                <p className="yard-about-description">{credit.description}</p>
              </div>
              <div className="yard-about-links">
                {credit.links.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                    {link.label}<ExternalLink size={13} />
                  </a>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
