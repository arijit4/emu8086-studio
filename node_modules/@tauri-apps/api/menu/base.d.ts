import { Resource } from '../core';
import { CheckMenuItemOptions } from './checkMenuItem';
import { IconMenuItemOptions } from './iconMenuItem';
import { MenuOptions } from './menu';
import { MenuItemOptions } from './menuItem';
import { PredefinedMenuItemOptions } from './predefinedMenuItem';
import { SubmenuOptions } from './submenu';
/**
 * The kind of a menu item, used internally to route IPC calls to the right
 * Rust-side type.
 *
 * @ignore
 */
export type ItemKind = 'MenuItem' | 'Predefined' | 'Check' | 'Icon' | 'Submenu' | 'Menu';
/**
 * Creates a menu or menu item on the Rust side. Implementation detail of the
 * `new` static methods of the menu classes.
 *
 * @ignore
 */
export declare function newMenu(kind: ItemKind, opts?: MenuOptions | MenuItemOptions | SubmenuOptions | PredefinedMenuItemOptions | CheckMenuItemOptions | IconMenuItemOptions): Promise<[number, string]>;
/**
 * The base class of every menu and menu item type.
 *
 * It is not constructible on its own: create a {@linkcode Menu}, {@linkcode Submenu},
 * {@linkcode MenuItem}, {@linkcode CheckMenuItem}, {@linkcode IconMenuItem} or
 * {@linkcode PredefinedMenuItem} instead. It provides the `id` shared by all of
 * them and, through {@linkcode Resource}, the `rid` and `close()` used to release
 * the Rust-side object.
 */
export declare class MenuItemBase extends Resource {
    #private;
    /** The id of this item. */
    get id(): string;
    /** @ignore */
    get kind(): string;
    /** @ignore */
    protected constructor(rid: number, id: string, kind: ItemKind);
}
