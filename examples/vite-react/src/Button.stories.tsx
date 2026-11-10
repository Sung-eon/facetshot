import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.tsx';

const meta = {
	title: 'Button',
	component: Button,
	// `autodocs` adds a docs page to the index; facetshot skips docs entries and shoots only stories.
	tags: ['autodocs'],
	args: { children: 'Save changes' }
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const LongLabel: Story = {
	args: { children: 'Save changes and send them to everyone on the team' }
};
/** A story facetshot leaves out: the `facetshot-skip` tag. */
export const Playground: Story = { tags: ['facetshot-skip'] };
