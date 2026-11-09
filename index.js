/**
 * Host half of the conversation-find plugin.
 *
 * The whole feature lives in the browser bundle: the conversation's rendered
 * transcript is client state and the find bar never asks the Host for anything.
 * The host row stays empty so the Loader has a package to activate and the
 * client module can be composed from the same package.
 */

export const name = 'conversation-find'
export const inject = []

/** No host-side behavior. */
export function apply() {}
