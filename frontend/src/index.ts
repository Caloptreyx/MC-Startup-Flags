import { faScaleBalanced } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { createElement } from 'react';
import { Extension, type ExtensionContext } from 'shared';
import Sidebar from '@/elements/navigation/Sidebar.tsx';
import EligibleSidebarLink from './components/EligibleSidebarLink.tsx';
import StartupFlagCard from './components/StartupFlagCard.tsx';
import { setConfiguredEggs } from './lib/indexConfig.ts';
import SettingsPage from './pages/SettingsPage.tsx';
import StartupFlagsPage from './pages/StartupFlagsPage.tsx';
import { getExtTranslations } from './translations.ts';

class DevCaloptreyxStartupFlagsExtension extends Extension {
  public cardIcon = createElement(FontAwesomeIcon, { icon: faScaleBalanced });
  public cardConfigurationPage: React.FC | null = SettingsPage;

  public initialize(ctx: ExtensionContext): void {
    setConfiguredEggs(this.getIndexVariable<string[]>('eggs'));

    ctx.extensionRegistry.enterRoutes((routes) =>
      routes.addServerRoute({
        name: () => getExtTranslations().t('title', {}),
        icon: faScaleBalanced,
        path: '/startup-flags',
        element: StartupFlagsPage,
        permission: 'startup-flags.read',
      }),
    );

    Sidebar.Link.addRenderInterceptor((element, props) => {
      if (props.to.endsWith('/startup-flags')) {
        return createElement(EligibleSidebarLink, { element }) as unknown as typeof element;
      }
      return element;
    });

    ctx.extensionRegistry.pages.server.startup.enterContainer((container) =>
      container.prependContentComponent(StartupFlagCard),
    );

    ctx.extensionRegistry.enterPermissionIcons((icons) =>
      icons.addServerPermissionIcon('startup-flags', createElement(FontAwesomeIcon, { icon: faScaleBalanced })),
    );
  }
}

export default new DevCaloptreyxStartupFlagsExtension();
