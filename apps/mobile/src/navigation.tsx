import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, type NavigatorScreenParams, type Theme as NavigationTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { usePrefs } from './prefs';
import { useSession } from './session';
import { RealtimeProvider } from './realtime';
import { useAccount, useOffers } from './hooks';
import { Icon, type IconName } from './ui/Icon';
import { AppText, Banner, Button, Screen } from './ui/kit';
import { LoginScreen, RegisterScreen, ServerScreen, StartupProblem, Wordmark } from './screens/AuthScreens';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OffersScreen } from './screens/OffersScreen';
import { DeliveryScreen } from './screens/DeliveryScreen';
import { MapScreen } from './screens/MapScreen';
import { EarningsScreen, HistoryScreen } from './screens/HistoryScreens';
import { AffiliationsScreen, NotificationsScreen, PersonalScreen, ProfileScreen, ServiceAreaScreen } from './screens/ProfileScreens';

export type RootStackParams = {
  Login: undefined; Register: undefined; Server: undefined; Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabParams> | undefined; Delivery: { id: string }; Map: undefined; Notifications: undefined; Earnings: undefined; Affiliations: undefined; ServiceArea: undefined; Personal: undefined;
};
export type TabParams = { Home: undefined; Offers: undefined; History: undefined; Profile: undefined };
const Stack = createNativeStackNavigator<RootStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

function Tabs() {
  const { t, colors } = usePrefs();
  const offers = useOffers();
  const icons: Record<keyof TabParams, IconName> = { Home: 'home', Offers: 'orders', History: 'clock', Profile: 'user' };
  const count = offers.data?.items.length ?? 0;
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' }, tabBarAllowFontScaling: true,
      tabBarIcon: ({ color, size }) => <Icon name={icons[route.name]} color={color} size={size} />,
    })}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('tabHome') }} />
      <Tab.Screen name="Offers" component={OffersScreen} options={{ title: t('tabOffers'), tabBarBadge: count > 0 ? count : undefined, tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent } }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: t('tabHistory') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: t('tabProfile') }} />
    </Tab.Navigator>
  );
}

/** Signed-in part: live socket, server-side preferences, then onboarding or the tabs. */
function SignedIn() {
  const { t, colors, language, theme, setLanguage, setTheme, errorText } = usePrefs();
  const account = useAccount();
  const settings = account.data?.settings;
  // The server keeps language and theme for the account across devices.
  useEffect(() => {
    if (!settings) return;
    if (settings.language !== language) setLanguage(settings.language);
    if (settings.theme !== theme) setTheme(settings.theme);
    // Runs only when the server copy changes; local changes are sent to the server by the profile screen.
  }, [settings?.language, settings?.theme]);
  if (!account.data) {
    if (account.isError) return <Screen><Banner tone="danger" text={errorText(account.error)} /><Button title={t('retry')} icon="refresh" onPress={() => void account.refetch()} /></Screen>;
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.accent} /></View>;
  }
  const header = { headerTintColor: colors.text, headerStyle: { backgroundColor: colors.bg }, headerTitleStyle: { color: colors.text }, headerShadowVisible: false, contentStyle: { backgroundColor: colors.bg } };
  return (
    <Stack.Navigator screenOptions={{ ...header, headerBackButtonDisplayMode: 'minimal' }}>
      {account.data.profile.onboardingCompleted ? (
        <>
          <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false, title: t('appName') }} />
          <Stack.Screen name="Delivery" component={DeliveryScreen} options={{ title: '' }} />
          <Stack.Screen name="Map" component={MapScreen} options={{ title: t('mapTitle') }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('notifTitle') }} />
          <Stack.Screen name="Earnings" component={EarningsScreen} options={{ title: t('earningsTitle') }} />
          <Stack.Screen name="Affiliations" component={AffiliationsScreen} options={{ title: t('restaurants') }} />
          <Stack.Screen name="ServiceArea" component={ServiceAreaScreen} options={{ title: t('workArea') }} />
          <Stack.Screen name="Personal" component={PersonalScreen} options={{ title: t('personal') }} />
        </>
      ) : <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />}
      <Stack.Screen name="Server" component={ServerScreen} options={{ title: t('serverTitle') }} />
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { theme, colors, ready, t } = usePrefs();
  const session = useSession();
  const navigationTheme: NavigationTheme = theme === 'dark'
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, primary: colors.accent, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.accent, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border } };
  if (!ready || session.status === 'starting') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.bg }}><Wordmark /><ActivityIndicator color={colors.accent} /><AppText muted>Courier</AppText></View>;
  }
  if (session.status === 'unreachable') return <StartupProblem />;
  const header = { headerTintColor: colors.text, headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, contentStyle: { backgroundColor: colors.bg } };
  return (
    <NavigationContainer theme={navigationTheme}>
      {session.status === 'signedIn'
        ? <RealtimeProvider><SignedIn /></RealtimeProvider>
        : (
          <Stack.Navigator screenOptions={{ ...header, headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false, title: t('appName') }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ title: '' }} />
            <Stack.Screen name="Server" component={ServerScreen} options={{ title: '' }} />
          </Stack.Navigator>
        )}
    </NavigationContainer>
  );
}
