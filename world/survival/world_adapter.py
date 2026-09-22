from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class WorldAdapter(Protocol):
    def snapshot(self) -> dict[str, Any]: ...

    def observe(self, radius: int = 8) -> dict[str, Any]: ...

    def open_lease(self, turn_id: str, expires_at: float, action_limit: int = 1) -> dict[str, Any]: ...

    def close_lease(self, blocking: bool = False) -> dict[str, Any]: ...

    def action(self, turn_id: str, tool: str, args: dict[str, Any]) -> dict[str, Any]: ...

    def action_status(self, body: dict[str, Any] | None = None) -> dict[str, Any]: ...

    def turn_receipts(self, turn_id: str) -> list[dict[str, Any]]: ...

    def inspect_block(self, x: int, y: int, z: int) -> dict[str, Any]: ...

    def inspect_container(self, x: int, y: int, z: int) -> dict[str, Any]: ...

    def sense(self, sensor: str = 'catalog', arguments: dict | None = None) -> dict[str, Any]: ...


def validate_sensor(sensor, arguments):
    """Declared read surface; no transport or game object enters the kernel."""
    if sensor not in ('self', 'scene', 'block', 'container', 'storage', 'menu') or not isinstance(arguments, dict):
        raise ValueError('invalid_sensor')
    if sensor in ('block', 'container', 'storage'):
        if set(arguments) != {'x', 'y', 'z'}:
            raise ValueError('invalid_sensor_arguments')
        for key, low, high in (('x', -29999984, 29999984), ('y', -64, 319), ('z', -29999984, 29999984)):
            if type(arguments[key]) is not int or not low <= arguments[key] <= high:
                raise ValueError('invalid_sensor_coordinates')
    elif sensor == 'scene':
        radius = arguments.get('radius', 8)
        if set(arguments) - {'radius'} or type(radius) is not int or not 4 <= radius <= 12:
            raise ValueError('invalid_sensor_radius')
    elif arguments:
        raise ValueError('invalid_sensor_arguments')
