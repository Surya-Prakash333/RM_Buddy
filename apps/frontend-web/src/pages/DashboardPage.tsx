import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useWidgetStore } from '@/store/widget.store';
import { WidgetRenderer } from '@/components/widgets/WidgetRenderer';

export default function DashboardPage(): JSX.Element {
  const widgets = useWidgetStore((s) => s.widgets);

  return (
    <DashboardLayout
      widgetTitle={widgets.length ? 'Insights' : undefined}
      widgetSubtitle={widgets.length ? `${widgets.length} widget${widgets.length > 1 ? 's' : ''}` : undefined}
      widgetContent={
        widgets.length ? (
          <>
            {widgets.map((w, i) => (
              <WidgetRenderer widget={w} key={`${w.widget_type}-${i}`} />
            ))}
          </>
        ) : undefined
      }
    />
  );
}
