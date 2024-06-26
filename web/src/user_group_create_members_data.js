import {page_params} from "./page_params";
import * as people from "./people";

let user_id_set;

export function initialize_with_current_user() {
    const current_user_id = page_params.user_id;
    user_id_set = new Set();
    user_id_set.add(current_user_id);
}

export function sorted_user_ids() {
    const users = people.get_users_from_ids([...user_id_set]);
    people.sort_but_pin_current_user_on_top(users);
    return users.map((user) => user.user_id);
}

export function get_all_user_ids() {
    const potential_members = people.get_realm_users();
    const user_ids = potential_members.map((user) => user.user_id);
    // sort for determinism
    user_ids.sort((a, b) => a - b);
    return user_ids;
}

export function get_principals() {
    // Return list of user ids which were selected by user.
    return [...user_id_set];
}

export function get_potential_members() {
    const potential_members = people.get_realm_users();
    return potential_members.filter((user) => !user_id_set.has(user.user_id));
}

export function add_user_ids(user_ids) {
    for (const user_id of user_ids) {
        if (!user_id_set.has(user_id)) {
            const user = people.maybe_get_user_by_id(user_id);
            if (user) {
                user_id_set.add(user_id);
            }
        }
    }
}

export function remove_user_ids(user_ids) {
    for (const user_id of user_ids) {
        user_id_set.delete(user_id);
    }
}
