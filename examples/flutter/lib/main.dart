// A small Flutter app for facetshot: two screens, a context menu, and a plan card that doesn't fit on a narrow
// screen (left in on purpose, for the checks to find). The same code runs on the web, on macOS and on iOS.
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';

void main() {
  // On the web, /settings is a real path; on macOS and iOS facetshot names the screen in FACETSHOT_ROUTE.
  usePathUrlStrategy();
  final route = kIsWeb ? null : Platform.environment['FACETSHOT_ROUTE'];
  runApp(LanternApp(initialRoute: route ?? '/'));
}

class LanternApp extends StatelessWidget {
  const LanternApp({super.key, required this.initialRoute});

  final String initialRoute;

  @override
  Widget build(BuildContext context) {
    final dark = !kIsWeb && Platform.environment['FACETSHOT_APPEARANCE'] == 'dark';
    return MaterialApp(
      title: 'Lantern',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.deepOrange),
      darkTheme: ThemeData(colorSchemeSeed: Colors.deepOrange, brightness: Brightness.dark),
      // The web follows the browser's colour scheme; the desktop and phone apps are told by facetshot.
      themeMode: kIsWeb ? ThemeMode.system : (dark ? ThemeMode.dark : ThemeMode.light),
      initialRoute: initialRoute,
      routes: {
        '/': (_) => const HomePage(),
        '/settings': (_) => const SettingsPage(),
      },
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lantern'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pushNamed(context, '/settings'),
            child: const Text('Settings'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Your plan', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 16),
          // On purpose: a row that never wraps, so on a phone its last card runs off the screen.
          const SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: NeverScrollableScrollPhysics(),
            child: Row(
              children: [
                PlanCard(name: 'Candle', price: 'Free'),
                PlanCard(name: 'Lamp', price: '\$4 a month'),
                PlanCard(name: 'Lighthouse', price: '\$12 a month'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class PlanCard extends StatelessWidget {
  const PlanCard({super.key, required this.name, required this.price});

  final String name;
  final String price;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: SizedBox(
        width: 220,
        height: 120,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: Theme.of(context).textTheme.titleLarge),
              Text(price),
            ],
          ),
        ),
      ),
    );
  }
}

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _name = TextEditingController(text: 'Ada Lovelace');
  bool _saved = false;

  void _save() {
    // What facetshot's logs show after pressing Save: the console on the web, standard output on macOS.
    debugPrint('Saving settings for ${_name.text}');
    setState(() => _saved = true);
  }

  Future<void> _menu(Offset at) async {
    final chosen = await showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(at.dx, at.dy, at.dx, at.dy),
      items: const [
        PopupMenuItem(value: 'reset', child: Text('Reset to defaults')),
        PopupMenuItem(value: 'copy', child: Text('Copy link to settings')),
      ],
    );
    if (chosen != null) debugPrint('Menu: $chosen');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: GestureDetector(
        onSecondaryTapDown: (details) => _menu(details.globalPosition),
        onLongPressStart: (details) => _menu(details.globalPosition),
        child: Container(
          color: Colors.transparent,
          padding: const EdgeInsets.all(24),
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: 360,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                const SizedBox(height: 16),
                FilledButton(onPressed: _save, child: const Text('Save')),
                if (_saved) const Padding(padding: EdgeInsets.only(top: 12), child: Text('Saved.')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
