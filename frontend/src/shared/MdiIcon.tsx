import Icon from "@mdi/react";

type MdiIconProps = {
  className?: string;
  path: string;
  size?: number | string;
  title?: string;
};

export function MdiIcon({ className = "mdi-icon", path, size = "1em", title }: MdiIconProps) {
  return (
    <Icon
      aria-hidden={title ? undefined : true}
      className={className}
      path={path}
      size={size}
      title={title}
    />
  );
}
