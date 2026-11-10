import { Button } from './Button.tsx';

export interface PlanCardProps {
	name: string;
	price: string;
	features: string[];
	highlighted?: boolean;
}

export function PlanCard({ name, price, features, highlighted }: PlanCardProps) {
	return (
		<article className={`plan${highlighted ? ' plan-highlighted' : ''}`}>
			<h2>{name}</h2>
			<p className="price">{price}</p>
			<ul>
				{features.map((feature) => (
					<li key={feature}>{feature}</li>
				))}
			</ul>
			<Button variant={highlighted ? 'primary' : 'secondary'}>Choose {name}</Button>
		</article>
	);
}
