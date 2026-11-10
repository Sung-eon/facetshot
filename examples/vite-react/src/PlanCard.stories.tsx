import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlanCard } from './PlanCard.tsx';

const meta = {
	title: 'Pricing/PlanCard',
	component: PlanCard,
	args: { name: 'Lamp', price: '$4', features: ['Unlimited notebooks', 'Sync everywhere'] }
} satisfies Meta<typeof PlanCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Highlighted: Story = { args: { highlighted: true } };
