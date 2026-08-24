import { Redirect } from 'expo-router';

/**
 * App entry — go to Recipes.
 *
 * The landing screen used to be the Plan tab (it owned the `index` route inside
 * `(tabs)`, so it WAS `/`). Recipes is what you actually open the app for, so
 * Plan moved to its own `/plan` route and this redirect took over `/`.
 *
 * Why a redirect route rather than `initialRouteName` on the tab navigator:
 * Stock is a web PWA, and on web the URL decides what renders. `/` maps to a
 * route, full stop — `initialRouteName` only sets the back-stack anchor, so
 * opening the site would still have drawn the Plan tab. This way the address
 * bar and the navigator agree, and a cold open, a refresh and an
 * Add-to-Home-Screen launch all land in the same place.
 */
export default function Index() {
  return <Redirect href="/recipes" />;
}
