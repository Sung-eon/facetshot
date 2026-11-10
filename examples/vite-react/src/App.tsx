import { useEffect, useState } from 'react';
import { Button } from './Button.tsx';
import { PlanCard } from './PlanCard.tsx';

/** Three screens and a router small enough to read: the path picks the screen. */
const ROUTES: Record<string, { title: string; view: () => React.ReactElement }> = {
	'/': { title: 'Home', view: Home },
	'/pricing': { title: 'Pricing', view: Pricing },
	'/settings': { title: 'Settings', view: Settings }
};

export function App() {
	const [path, setPath] = useState(location.pathname);
	useEffect(() => {
		const onPop = () => setPath(location.pathname);
		addEventListener('popstate', onPop);
		return () => removeEventListener('popstate', onPop);
	}, []);
	const go = (to: string) => (event: React.MouseEvent) => {
		event.preventDefault();
		history.pushState(null, '', to);
		setPath(to);
	};
	const route = ROUTES[path] ?? ROUTES['/'];
	const View = route.view;
	return (
		<div className="shell">
			<header className="bar">
				<strong className="brand">Lantern</strong>
				<nav>
					{Object.entries(ROUTES).map(([to, { title }]) => (
						<a key={to} href={to} onClick={go(to)} aria-current={to === path ? 'page' : undefined}>
							{title}
						</a>
					))}
				</nav>
			</header>
			<main>
				<View />
			</main>
		</div>
	);
}

function Home() {
	return (
		<section className="hero">
			<h1>Light for the long evenings.</h1>
			<p>Lantern keeps your notes, your lists and your plans in one quiet place.</p>
			<div className="row">
				<Button>Start writing</Button>
				<Button variant="secondary">Take the tour</Button>
			</div>
		</section>
	);
}

function Pricing() {
	// On purpose: three fixed-width cards in a row that never wraps. On a phone the row is wider than the screen,
	// which is what facetshot's `overflow` check is there to find.
	return (
		<section>
			<h1>Pricing</h1>
			<div className="plans">
				<PlanCard name="Candle" price="Free" features={['3 notebooks', 'Sync on one device']} />
				<PlanCard
					name="Lamp"
					price="$4"
					features={['Unlimited notebooks', 'Sync everywhere']}
					highlighted
				/>
				<PlanCard
					name="Lighthouse"
					price="$9"
					features={['Everything in Lamp', 'Shared notebooks for teams']}
				/>
			</div>
		</section>
	);
}

function Settings() {
	return (
		<section className="settings">
			<h1>Settings</h1>
			<label>
				Name
				<input defaultValue="Ada Lovelace" />
			</label>
			<label className="check">
				<input type="checkbox" defaultChecked /> Send me a weekly summary
			</label>
			{/* On purpose: a one-line label that is cut off mid-word on narrow screens (the `clipped` check). */}
			<p className="hint">
				Your notes are encrypted on this device before they are sent anywhere, including to our
				servers.
			</p>
			<Button>Save</Button>
		</section>
	);
}
