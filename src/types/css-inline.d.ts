/**
 * Type declarations for ?inline CSS imports
 * These imports return the CSS content as a string instead of injecting into DOM
 */
declare module "*?inline" {
	const content: string;
	export default content;
}

declare module "*.css?inline" {
	const content: string;
	export default content;
}
