import $ from "jquery";
import _ from "lodash";

import render_unsubscribe_private_stream_modal from "../templates/confirm_dialog/confirm_unsubscribe_private_stream.hbs";
import render_inline_decorated_stream_name from "../templates/inline_decorated_stream_name.hbs";
import render_browse_streams_list from "../templates/stream_settings/browse_streams_list.hbs";
import render_browse_streams_list_item from "../templates/stream_settings/browse_streams_list_item.hbs";
import render_selected_stream_title from "../templates/stream_settings/selected_stream_title.hbs";
import render_stream_settings from "../templates/stream_settings/stream_settings.hbs";
import render_work_sku_overlay from "../templates/stream_settings/work_sku_overlay.hbs";
import render_work_sku_info from "../templates/stream_settings/work_sku_info.hbs";
import render_work_sku_list from "../templates/stream_settings/work_sku_list.hbs";

import * as blueslip from "./blueslip";
import * as browser_history from "./browser_history";
import * as channel from "./channel";
import * as components from "./components";
import * as compose_state from "./compose_state";
import * as confirm_dialog from "./confirm_dialog";
import {DropdownListWidget} from "./dropdown_list_widget";
import * as hash_util from "./hash_util";
import {$t, $t_html} from "./i18n";
import * as keydown_util from "./keydown_util";
import * as loading from "./loading";
import * as message_lists from "./message_lists";
import * as message_live_update from "./message_live_update";
import * as message_view_header from "./message_view_header";
import * as overlays from "./overlays";
import {page_params} from "./page_params";
import * as peer_data from "./peer_data";
import * as people from "./people";
import * as scroll_util from "./scroll_util";
import * as search_util from "./search_util";
import * as settings_config from "./settings_config";
import * as settings_data from "./settings_data";
import * as stream_create from "./stream_create";
import * as stream_data from "./stream_data";
import * as work_sku_edit from "./work_sku_edit";
import * as stream_edit_subscribers from "./stream_edit_subscribers";
import * as stream_list from "./stream_list";
import * as stream_muting from "./stream_muting";
import * as stream_settings_data from "./stream_settings_data";
import * as stream_ui_updates from "./stream_ui_updates";
import * as sub_store from "./sub_store";
import * as ui_report from "./ui_report";
import * as user_groups from "./user_groups";
import * as util from "./util";
import * as upload_widget from "./upload_widget";
import * as dialog_widget from "./dialog_widget";

export function set_right_panel_title(sub) {
    let title_icon_color = "#333333";
    if (settings_data.using_dark_theme()) {
        title_icon_color = "#dddeee";
    }
    $("#work_sku_overlay .stream-info-title").html(
        render_selected_stream_title({sub, title_icon_color}),
    );
}

export const show_subs_pane = {
    nothing_selected() {
        $(".settings, #work_stream-creation").hide();
        $(".nothing-selected").show();
        $("#work_sku_overlay .stream-info-title").text($t({defaultMessage: "Stream settings"}));
    },
    settings(sub) {
        $(".settings, #work_stream-creation").hide();
        $(".settings").show();
        set_right_panel_title(sub);
    },
    create_stream() {
        $(".nothing-selected, .settings, #work_stream-creation").hide();
        $("#work_stream-creation").show();
        $("#work_sku_overlay .stream-info-title").text($t({defaultMessage: "Create stream"}));
    },
};

export function row_for_stream_id(stream_id) {
    return $(`.stream-row[data-stream-id='${CSS.escape(stream_id)}']`);
}

export function is_sub_already_present(sub) {
    return row_for_stream_id(sub.stream_id).length > 0;
}

export function update_left_panel_row(sub) {
    const $row = row_for_stream_id(sub.stream_id);

    if ($row.length === 0) {
        return;
    }

    blueslip.debug(`Updating row in left panel of stream settings for: ${sub.name}`);
    const setting_sub = stream_settings_data.get_sub_for_settings(sub);
    const html = render_browse_streams_list_item(setting_sub);
    const $new_row = $(html);

    // TODO: Clean up this hack when we eliminate `notdisplayed`
    if ($row.hasClass("notdisplayed")) {
        $new_row.addClass("notdisplayed");
    }

    // TODO: Remove this if/when we just handle "active" when rendering templates.
    if ($row.hasClass("active")) {
        $new_row.addClass("active");
    }

    $row.replaceWith($new_row);
}

export function settings_button_for_sub(sub) {
    // We don't do expectOne() here, because this button is only
    // visible if the user has that stream selected in the streams UI.
    return $(
        `.stream_settings_header[data-stream-id='${CSS.escape(sub.stream_id)}'] .subscribe-button`,
    );
}

function get_row_data($row) {
    const row_id = Number.parseInt($row.attr("data-stream-id"), 10);
    if (row_id) {
        const row_object = sub_store.get(row_id);
        return {
            id: row_id,
            object: row_object,
        };
    }
    return undefined;
}

export function get_active_data() {
    const $active_row = $("div.stream-row.active");
    const valid_active_id = Number.parseInt($active_row.attr("data-stream-id"), 10);
    const $active_tabs = $(".subscriptions-container").find("div.ind-tab.selected");
    return {
        $row: $active_row,
        id: valid_active_id,
        $tabs: $active_tabs,
    };
}

function selectText(element) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);

    sel.removeAllRanges();
    sel.addRange(range);
}

function should_list_all_streams() {
    return !page_params.realm_is_zephyr_mirror_realm;
}

export function set_muted(sub, is_muted, status_element) {
    stream_muting.update_is_muted(sub, is_muted);
    work_sku_edit.set_stream_property(sub, "is_muted", sub.is_muted, status_element);
}

export function toggle_pin_to_top_stream(sub) {
    work_sku_edit.set_stream_property(sub, "pin_to_top", !sub.pin_to_top);
}

let subscribed_only = true;

export function is_subscribed_stream_tab_active() {
    // Returns true if "Subscribed" tab in stream settings is open
    // otherwise false.
    return subscribed_only;
}

export function update_stream_name(sub, new_name) {
    const old_name = sub.name;

    // Rename the stream internally.
    stream_data.rename_sub(sub, new_name);
    const stream_id = sub.stream_id;

    // Update the left sidebar.
    stream_list.rename_stream(sub, new_name);

    // Update the stream settings
    work_sku_edit.update_stream_name(sub, new_name);

    // Update the subscriptions page
    const $sub_row = row_for_stream_id(stream_id);
    $sub_row.find(".stream-name").text(new_name);

    // Update the message feed.
    message_live_update.update_stream_name(stream_id, new_name);

    // Update compose_state if needed
    if (compose_state.stream_name() === old_name) {
        compose_state.set_stream_name(new_name);
    }

    // Update navbar if needed
    message_view_header.maybe_rerender_title_area_for_stream(sub);
}

export function update_stream_description(sub, description, rendered_description) {
    sub.description = description;
    sub.rendered_description = rendered_description;
    stream_data.clean_up_description(sub);

    // Update stream row
    const $sub_row = row_for_stream_id(sub.stream_id);
    $sub_row.find(".description").html(util.clean_user_content_links(sub.rendered_description));

    // Update stream settings
    work_sku_edit.update_stream_description(sub);

    // Update navbar if needed
    message_view_header.maybe_rerender_title_area_for_stream(sub);
}

export function update_stream_privacy(slim_sub, values) {
    stream_data.update_stream_privacy(slim_sub, values);
    const sub = stream_settings_data.get_sub_for_settings(slim_sub);

    // Update UI elements
    update_left_panel_row(sub);
    message_lists.current.update_trailing_bookend();
    stream_ui_updates.update_setting_element(sub, "stream_privacy");
    stream_ui_updates.enable_or_disable_permission_settings_in_edit_panel(sub);
    stream_ui_updates.update_stream_privacy_icon_in_settings(sub);
    stream_ui_updates.update_settings_button_for_sub(sub);
    stream_ui_updates.update_add_subscriptions_elements(sub);
    stream_ui_updates.enable_or_disable_subscribers_tab(sub);
    stream_list.redraw_stream_privacy(sub);

    const active_data = get_active_data();
    if (active_data.id === sub.stream_id) {
        set_right_panel_title(sub);
    }

    // Update navbar if needed
    message_view_header.maybe_rerender_title_area_for_stream(sub);
}

export function update_stream_post_policy(sub, new_value) {
    stream_data.update_stream_post_policy(sub, new_value);
    stream_ui_updates.update_setting_element(sub, "stream_post_policy");
}

export function update_message_retention_setting(sub, new_value) {
    stream_data.update_message_retention_setting(sub, new_value);
    stream_ui_updates.update_setting_element(sub, "message_retention_days");
}

export function update_can_remove_subscribers_group_id(sub, new_value) {
    stream_data.update_can_remove_subscribers_group_id(sub, new_value);
    stream_ui_updates.update_setting_element(sub, "can_remove_subscribers_group_id");
    stream_edit_subscribers.rerender_subscribers_list(sub);
}

export function set_color(stream_id, color) {
    const sub = sub_store.get(stream_id);
    work_sku_edit.set_stream_property(sub, "color", color);
}

export function update_subscribers_ui(sub) {
    update_left_panel_row(sub);
    stream_edit_subscribers.update_subscribers_list(sub);
    message_view_header.maybe_rerender_title_area_for_stream(sub);
}

export function add_sub_to_table(sub) {
    if (is_sub_already_present(sub)) {
        // If a stream is already listed/added in subscription modal,
        // display stream in `Subscribed` tab and return.
        // This can happen in some corner cases (which might
        // be backend bugs) where a realm administrator is subscribed
        // to a private stream, in which case they might get two
        // stream-create events.
        stream_ui_updates.update_stream_row_in_settings_tab(sub);
        return;
    }

    const setting_sub = stream_settings_data.get_sub_for_settings(sub);
    const html = render_browse_streams_list_item(setting_sub);
    const $new_row = $(html);

    // if (stream_create.get_name() === sub.name) {
    //     scroll_util.get_content_element($(".streams-list")).prepend($new_row);
    //     scroll_util.reset_scrollbar($(".streams-list"));
    // } else {
    //     scroll_util.get_content_element($(".streams-list")).append($new_row);
    // }

    const settings_html = render_stream_settings({
        sub: stream_settings_data.get_sub_for_settings(sub),
    });
    scroll_util
        .get_content_element($("#work_sku_overlay_container .settings"))
        .append($(settings_html));

    // if (stream_create.get_name() === sub.name) {
    //     // This `stream_create.get_name()` check tells us whether the
    //     // stream was just created in this browser window; it's a hack
    //     // to work around the server_events code flow not having a
    //     // good way to associate with this request because the stream
    //     // ID isn't known yet.  These are appended to the top of the
    //     // list, so they are more visible.
    //     row_for_stream_id(sub.stream_id).trigger("click");
    //     stream_create.reset_created_stream();
    // }
    update_empty_left_panel_message();
}

export function remove_stream(stream_id) {
    // It is possible that row is empty when we deactivate a
    // stream, but we let jQuery silently handle that.
    const $row = row_for_stream_id(stream_id);
    $row.remove();
    update_empty_left_panel_message();
    if (hash_util.is_editing_stream(stream_id)) {
        work_sku_edit.open_edit_panel_empty();
    }
}

export function update_settings_for_subscribed(slim_sub) {
    const sub = stream_settings_data.get_sub_for_settings(slim_sub);
    stream_ui_updates.update_add_subscriptions_elements(sub);
    $(
        `.stream_settings_header[data-stream-id='${CSS.escape(
            sub.stream_id,
        )}'] #preview-stream-button`,
    ).show();

    if (is_sub_already_present(sub)) {
        update_left_panel_row(sub);
        stream_ui_updates.update_toggler_for_sub(sub);
        stream_ui_updates.update_stream_row_in_settings_tab(sub);
        stream_ui_updates.update_settings_button_for_sub(sub);
        stream_ui_updates.enable_or_disable_permission_settings_in_edit_panel(sub);
    } else {
        add_sub_to_table(sub);
    }

    stream_edit_subscribers.update_subscribers_list(sub);

    // Display the swatch and subscription stream_settings
    stream_ui_updates.update_regular_sub_settings(sub);
    stream_ui_updates.update_permissions_banner(sub);

    // Update whether there's any streams shown or not.
    update_empty_left_panel_message();
}

export function show_active_stream_in_left_panel() {
    const selected_row = hash_util.get_current_hash_section();

    if (Number.parseFloat(selected_row)) {
        const $sub_row = row_for_stream_id(selected_row);
        $sub_row.addClass("active");
    }
}

export function update_settings_for_unsubscribed(slim_sub) {
    const sub = stream_settings_data.get_sub_for_settings(slim_sub);
    update_left_panel_row(sub);
    stream_edit_subscribers.update_subscribers_list(sub);
    stream_ui_updates.update_toggler_for_sub(sub);
    stream_ui_updates.update_settings_button_for_sub(sub);
    stream_ui_updates.update_regular_sub_settings(sub);
    stream_ui_updates.enable_or_disable_permission_settings_in_edit_panel(sub);

    // If user unsubscribed from private stream then user cannot subscribe to
    // stream without invitation and cannot add subscribers to stream.
    if (!stream_data.can_toggle_subscription(sub)) {
        stream_ui_updates.update_add_subscriptions_elements(sub);
    }
    if (page_params.is_guest) {
        work_sku_edit.open_edit_panel_empty();
    }

    // Remove private streams from subscribed streams list.
    stream_ui_updates.update_stream_row_in_settings_tab(sub);
    stream_ui_updates.update_permissions_banner(sub);

    update_empty_left_panel_message();
}

function triage_stream(left_panel_params, sub) {
    if (left_panel_params.subscribed_only && !sub.subscribed) {
        // reject non-subscribed streams
        return "rejected";
    }

    const search_terms = search_util.get_search_terms(left_panel_params.input);

    function match(attr) {
        const val = sub[attr];

        return search_util.vanilla_match({
            val,
            search_terms,
        });
    }

    if (match("name")) {
        return "name_match";
    }

    if (match("description")) {
        return "desc_match";
    }

    return "rejected";
}

function get_stream_id_buckets(stream_ids, left_panel_params) {
    // When we simplify the settings UI, we can get
    // rid of the "others" bucket.

    const buckets = {
        name: [],
        desc: [],
        other: [],
    };

    for (const stream_id of stream_ids) {
        const sub = sub_store.get(stream_id);
        const match_status = triage_stream(left_panel_params, sub);

        if (match_status === "name_match") {
            buckets.name.push(stream_id);
        } else if (match_status === "desc_match") {
            buckets.desc.push(stream_id);
        } else {
            buckets.other.push(stream_id);
        }
    }

    stream_settings_data.sort_for_stream_settings(buckets.name, left_panel_params.sort_order);
    stream_settings_data.sort_for_stream_settings(buckets.desc, left_panel_params.sort_order);

    return buckets;
}

export function render_left_panel_superset() {
    // For annoying legacy reasons we render all the subs we are
    // allowed to know about and put them in the DOM, then we do
    // a second pass where we filter/sort them.
    const html = render_browse_streams_list({
        subscriptions: stream_settings_data.get_updated_unsorted_subs(),
    });

    scroll_util.get_content_element($("#work_sku_overlay_container .streams-list")).html(html);
}

export function update_empty_left_panel_message() {
    // Check if we have any streams in panel to decide whether to
    // display a notice.
    let has_streams;
    if (is_subscribed_stream_tab_active()) {
        // We don't remove stream row from UI on unsubscribe, To handle
        // this case here we are also checking DOM if there are streams
        // displayed in panel or not.
        has_streams =
            stream_data.subscribed_subs().length ||
            $("#work_sku_overlay_container .stream-row:not(.notdisplayed)").length;
    } else {
        has_streams = stream_data.get_unsorted_subs().length;
    }
    if (has_streams) {
        $(".no-streams-to-show").hide();
        return;
    }
    if (is_subscribed_stream_tab_active()) {
        $(".all_streams_tab_empty_text").hide();
        $(".subscribed_streams_tab_empty_text").show();
    } else {
        $(".subscribed_streams_tab_empty_text").hide();
        $(".all_streams_tab_empty_text").show();
    }
    $(".no-streams-to-show").show();
}

// LeftPanelParams { input: String, subscribed_only: Boolean, sort_order: String }
export function redraw_left_panel(left_panel_params = get_left_panel_params()) {
    // We only get left_panel_params passed in from tests.  Real
    // code calls get_left_panel_params().
    show_active_stream_in_left_panel();

    function stream_id_for_row(row) {
        return Number.parseInt($(row).attr("data-stream-id"), 10);
    }

    const widgets = new Map();

    const stream_ids = [];

    for (const row of $("#work_sku_overlay_container .stream-row")) {
        const stream_id = stream_id_for_row(row);
        stream_ids.push(stream_id);
    }

    const buckets = get_stream_id_buckets(stream_ids, left_panel_params);

    // If we just re-built the DOM from scratch we wouldn't need
    // all this hidden/notdisplayed logic.
    const hidden_ids = new Set();

    for (const stream_id of buckets.other) {
        hidden_ids.add(stream_id);
    }

    for (const row of $("#work_sku_overlay_container .stream-row")) {
        const stream_id = stream_id_for_row(row);

        // Below code goes away if we don't do sort-DOM-in-place.
        if (hidden_ids.has(stream_id)) {
            $(row).addClass("notdisplayed");
        } else {
            $(row).removeClass("notdisplayed");
        }

        widgets.set(stream_id, $(row).detach());
    }

    scroll_util.reset_scrollbar($("#work_sku_overlay .streams-list"));

    const all_stream_ids = [...buckets.name, ...buckets.desc, ...buckets.other];

    for (const stream_id of all_stream_ids) {
        scroll_util
            .get_content_element($("#work_sku_overlay_container .streams-list"))
            .append(widgets.get(stream_id));
    }
    maybe_reset_right_panel();
    update_empty_left_panel_message();

    // return this for test convenience
    return [...buckets.name, ...buckets.desc];
}

let sort_order = "by-stream-name";

export function get_left_panel_params() {
    const $search_box = $("#work_sku_filter input[type='text']");
    const input = $search_box.expectOne().val().trim();
    const params = {
        input,
        subscribed_only,
        sort_order,
    };
    return params;
}

export function maybe_reset_right_panel() {
    if ($(".stream-row.active").hasClass("notdisplayed")) {
        $(".right .settings").hide();
        $(".nothing-selected").show();
        $(".stream-row.active").removeClass("active");
    }
}

// Make it explicit that our toggler is not created right away.
export let toggler;

let mySkuPage = 1;
let mySkuTotal = 0;
const pageSize = 10;
const emptyList = [{
    pid: '',
    img: '',
    author: '',
    shortDesc: '',
    title: ''
}];

export function switch_stream_tab(tab_name) {
    /*
        This switches the stream tab, but it doesn't update
        the toggler widget.  You may instead want to
        use `toggler.goto`.
    */

    if (tab_name === "all-streams") {
        subscribed_only = false;
    } else if (tab_name === "subscribed") {
        subscribed_only = true;
    }

    redraw_left_panel();
    work_sku_edit.setup_subscriptions_tab_hash(tab_name);
}

export function switch_stream_sort(tab_name) {
    if (
        tab_name === "by-stream-name" ||
        tab_name === "by-subscriber-count" ||
        tab_name === "by-weekly-traffic"
    ) {
        sort_order = tab_name;
    } else {
        sort_order = "by-stream-name";
    }
    redraw_left_panel();
}

// export let new_stream_can_remove_subscribers_group_widget = null;

export function setup_page(callback) {
    // We should strongly consider only setting up the page once,
    // but I am writing these comments write before a big release,
    // so it's too risky a change for now.
    //
    // The history behind setting up the page from scratch every
    // time we go into "Manage streams" is that we used to have
    // some live-update issues, so being able to re-launch the
    // streams page is kind of a workaround for those bugs, since
    // we will re-populate the widget.
    //
    // For now, every time we go back into the widget we'll
    // continue the strategy that we re-render everything from scratch.
    // Also, we'll always go back to the "Subscribed" tab.
    function initialize_components() {
        // Sort by name by default when opening "Manage streams".
        sort_order = "by-stream-name";
        const sort_toggler = components.toggle({
            values: [
                // {
                //     label_html: `<i class="fa fa-sort-alpha-asc" data-tippy-content="${$t({
                //         defaultMessage: "Sort by name",
                //     })}"></i>`,
                //     key: "by-stream-name",
                // },
                // {
                //     label_html: `<i class="fa fa-sort-amount-asc" data-tippy-content="${$t({
                //         defaultMessage: "Sort by number of subscribers",
                //     })}"></i>`,
                //     key: "by-subscriber-count",
                // },
            ],
            html_class: "stream_sorter_toggle",
            callback(_value, key) {
                switch_stream_sort(key);
            },
        });

        // sku过滤按钮
        $("#work_sku_overlay_container .search-container").prepend(sort_toggler.get());

        // Reset our internal state to reflect that we're initially in
        // the "Subscribed" tab if we're reopening "Manage streams".
        subscribed_only = true;
        // toggler = components.toggle({
        //     child_wants_focus: true,
        //     values: [
        //         {label: $t({defaultMessage: "已收藏"}), key: "subscribed"},
        //         {label: $t({defaultMessage: "全部工作流"}), key: "all-streams"},
        //     ],
        //     callback(_value, key) {
        //         switch_stream_tab(key);
        //     },
        // });

        // if (should_list_all_streams()) {
        //     const toggler_elem = toggler.get();
        //     $("#work_sku_overlay_container .search-container").prepend(toggler_elem);
        // }
        // if (page_params.is_guest) {
        //     toggler.disable_tab("all-streams");
        // }

        // show the "Stream settings" header by default.
        // $(".display-type #work_stream_settings_title").show();
    }

    function populate_and_fill() {
        $("#work_sku_overlay_container").empty();

        const opts = {
            widget_name: "new_stream_can_remove_subscribers_group_id",
            data: user_groups.get_realm_user_groups_for_dropdown_list_widget(
                "can_remove_subscribers_group",
            ),
            default_text: $t({defaultMessage: "No user groups"}),
            include_current_item: false,
            value: user_groups.get_user_group_from_name("@role:administrators").id,
        };
        // new_stream_can_remove_subscribers_group_widget = new DropdownListWidget(opts);

        // TODO: Ideally we'd indicate in some way what stream types
        // the user can create, by showing other options as disabled.
        // const stream_privacy_policy = stream_data.stream_privacy_policy_values.public.code;
        // const notifications_stream = stream_data.get_notifications_stream();
        // const notifications_stream_sub = stream_data.get_sub_by_name(notifications_stream);

        const template_data = {
            // notifications_stream_sub,
            ask_to_announce_stream: true,
            can_create_streams:
                settings_data.user_can_create_private_streams() ||
                settings_data.user_can_create_public_streams() ||
                settings_data.user_can_create_web_public_streams(),
            can_view_all_streams: !page_params.is_guest && should_list_all_streams(),
            max_stream_name_length: page_params.max_stream_name_length,
            max_stream_description_length: page_params.max_stream_description_length,
            is_owner: page_params.is_owner,
            stream_privacy_policy_values: stream_data.stream_privacy_policy_values,
            // stream_privacy_policy,
            stream_post_policy_values: stream_data.stream_post_policy_values,
            zulip_plan_is_not_limited: page_params.zulip_plan_is_not_limited,
            org_level_message_retention_setting:
                work_sku_edit.get_display_text_for_realm_message_retention_setting(),
            upgrade_text_for_wide_organization_logo:
                page_params.upgrade_text_for_wide_organization_logo,
            is_business_type_org:
                page_params.realm_org_type === settings_config.all_org_type_values.business.code,
            disable_message_retention_setting:
                !page_params.zulip_plan_is_not_limited || !page_params.is_owner,
        };

        const rendered = render_work_sku_overlay(template_data);
        $("#work_sku_overlay_container").append(rendered);

        // render_left_panel_superset();
        render_my_sku_list();
        initialize_components();

        build_sku_cover_widget(upload_cover);
        build_sku_img_list_widget(upload_img_list);
        // redraw_left_panel();
        // stream_create.set_up_handlers();

        scroll_util.on_scroll_to_bottom($("#work_sku_overlay .work-sku-list"), () => {
            if (mySkuPage <= calculateTotalPages(mySkuTotal, pageSize)) {
                mySkuPage ++;
                render_my_sku_list();
            }
        })

        const throttled_redraw_left_panel = _.throttle(redraw_left_panel, 50);
        $("#work_sku_filter input[type='text']").on("input", () => {
            // Debounce filtering in case a user is typing quickly
            throttled_redraw_left_panel();
        });

        // When hitting Enter in the stream creation box, we open the
        // "create stream" UI with the stream name prepopulated.  This
        // is only useful if the user has permission to create
        // streams, either explicitly via user_can_create_streams, or
        // implicitly because page_params.realm_is_zephyr_mirror_realm.
        $("#work_sku_filter input[type='text']").on("keypress", (e) => {
            if (!keydown_util.is_enter_event(e)) {
                return;
            }

            if (
                settings_data.user_can_create_private_streams() ||
                settings_data.user_can_create_public_streams() ||
                settings_data.user_can_create_web_public_streams() ||
                page_params.realm_is_zephyr_mirror_realm
            ) {
                open_create_stream();
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        });

        $("#sku_clear_search_stream_name").on("click", () => {
            $("#work_sku_filter input[type='text']").val("");
            redraw_left_panel();
        });

        if (callback) {
            callback();
        }
    }

    populate_and_fill();

    if (!should_list_all_streams()) {
        $(".create_stream_button").val($t({defaultMessage: "Subscribe"}));
    }
}

export function switch_to_stream_row(stream_id) {
    const $stream_row = row_for_stream_id(stream_id);
    const $container = $(".streams-list");

    get_active_data().$row.removeClass("active");
    $stream_row.addClass("active");

    scroll_util.scroll_element_into_container($stream_row, $container);

    // It's dubious that we need this timeout any more.
    setTimeout(() => {
        if (stream_id === get_active_data().id) {
            $stream_row.trigger("click");
        }
    }, 100);
}

async function get_sku_tezheng(skuId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/sku/tezheng?skuId=${skuId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取SKU特征失败:', error);
        return null;
    }
}

async function show_right_section(id) {
    show_loading();

    const [skuDetail, skuTezheng] = await Promise.all([
        channel.get({
            url: `https://rpa.insfair.cn/zmtapi/sku/get?id=${id}`,
        }),
        get_sku_tezheng(id)
    ]);

    if (skuDetail.code === 200) {
        if (skuDetail.result.skuUrl && typeof skuDetail.result.skuUrl === 'string') {
            try {
                skuDetail.result.skuUrl = JSON.parse(skuDetail.result.skuUrl);
            } catch (e) {
                console.error('skuUrl 解析失败:', e);
                skuDetail.result.skuUrl = [];
            }
        } else {
            skuDetail.result.skuUrl = [];
        }

        const html = render_work_sku_info({
            detail: skuDetail.result,
            tezheng: skuTezheng
        });

        $("#work_sku_info_tem").html(html);
        work_sku_edit.setup_my_sku_hash(skuDetail.result);
    }

    $(".right").addClass("show");
    $(".subscriptions-header").addClass("slide-left");

    hide_loading();
}

export function change_state(section) {
    // if in #work_streams/new form.
    if (section === "new") {
        show_add_section();
        // if (!page_params.is_guest) {
            // do_open_create_stream();
            // show_right_section();
        // } else {
        //     toggler.goto("subscribed");
        // }
        // return;
    }

    if (section === "all") {
        toggler.goto("all-streams");
        return;
    }

    if (section === "subscribed") {
        toggler.goto("subscribed");
        return;
    }

    // if the section is a valid number.
    if (/\d+/.test(section)) {
        const id = Number.parseInt(section, 10);
        // const sub = sub_store.get(stream_id);
        // There are a few situations where we can't display stream settings:
        // 1. This is a stream that's been archived. (sub=undefined)
        // 2. The stream ID is invalid. (sub=undefined)
        // 3. The current user is a guest, and was unsubscribed from the stream
        //    stream in the current session. (In future sessions, the stream will
        //    not be in sub_store).
        //
        // In all these cases we redirect the user to 'subscribed' tab.
        // if (!sub || (page_params.is_guest && !stream_data.is_subscribed(stream_id))) {
        //     toggler.goto("subscribed");
        // } else {
            show_right_section(id);
            // switch_to_stream_row(stream_id);
        // }
        return;
    }

    blueslip.warn("invalid section for streams: " + section);
    // toggler.goto("subscribed");
}

export function launch(section) {
    setup_page(() => {
        overlays.open_overlay({
            name: "work_skus",
            $overlay: $("#work_sku_overlay"),
            on_close() {
                browser_history.exit_overlay();
                $(".colorpicker").spectrum("destroy");
            },
        });
        change_state(section);
    });
    if (!get_active_data().id) {
        if (section === "new") {
            $("#create_stream_name").trigger("focus");
        } else {
            $("#sku_search_stream_name").trigger("focus");
        }
    }
}

export function switch_rows(event) {
    const active_data = get_active_data();
    let $switch_row;
    if (hash_util.is_create_new_stream_narrow()) {
        // Prevent switching stream rows when creating a new stream
        return false;
    } else if (!active_data.id || active_data.$row.hasClass("notdisplayed")) {
        $switch_row = $("div.stream-row:not(.notdisplayed)").first();
        if ($("#sku_search_stream_name").is(":focus")) {
            $("#sku_search_stream_name").trigger("blur");
        }
    } else {
        if (event === "up_arrow") {
            $switch_row = active_data.$row.prevAll().not(".notdisplayed").first();
        } else if (event === "down_arrow") {
            $switch_row = active_data.$row.nextAll().not(".notdisplayed").first();
        }
        if ($("#sku_search_stream_name").is(":focus")) {
            // remove focus from Filter streams input instead of switching rows
            // if Filter streams input is focused
            return $("#sku_search_stream_name").trigger("blur");
        }
    }

    const row_data = get_row_data($switch_row);
    if (row_data) {
        const stream_id = row_data.id;
        switch_to_stream_row(stream_id);
    } else if (event === "up_arrow" && !row_data) {
        $("#sku_search_stream_name").trigger("focus");
    }
    return true;
}

export function keyboard_sub() {
    const active_data = get_active_data();
    const row_data = get_row_data(active_data.$row);
    if (row_data) {
        sub_or_unsub(row_data.object);
    }
}

export function toggle_view(event) {
    const active_data = get_active_data();
    const stream_filter_tab = active_data.$tabs.first().text();

    if (event === "right_arrow" && stream_filter_tab === "Subscribed") {
        toggler.goto("all-streams");
    } else if (event === "left_arrow" && stream_filter_tab === "All streams") {
        toggler.goto("subscribed");
    }
}

export function view_stream() {
    const active_data = get_active_data();
    const row_data = get_row_data(active_data.$row);
    if (row_data) {
        const stream_narrow_hash =
            "#narrow/stream/" + hash_util.encode_stream_name(row_data.object.name);
        browser_history.go_to_location(stream_narrow_hash);
    }
}

/* For the given stream_row, remove the tick and replace by a spinner. */
function display_subscribe_toggle_spinner(stream_row) {
    /* Prevent sending multiple requests by removing the button class. */
    $(stream_row).find(".check").removeClass("sub_unsub_button");

    /* Hide the tick. */
    const $tick = $(stream_row).find("svg");
    $tick.addClass("hide");

    /* Add a spinner to show the request is in process. */
    const $spinner = $(stream_row).find(".sub_unsub_status").expectOne();
    $spinner.show();
    loading.make_indicator($spinner);
}

/* For the given stream_row, add the tick and delete the spinner. */
function hide_subscribe_toggle_spinner(stream_row) {
    /* Re-enable the button to handle requests. */
    $(stream_row).find(".check").addClass("sub_unsub_button");

    /* Show the tick. */
    const $tick = $(stream_row).find("svg");
    $tick.removeClass("hide");

    /* Destroy the spinner. */
    const $spinner = $(stream_row).find(".sub_unsub_status").expectOne();
    loading.destroy_indicator($spinner);
}

function ajaxSubscribe(stream, color, $stream_row) {
    // Subscribe yourself to a single stream.
    let true_stream_name;

    if ($stream_row !== undefined) {
        display_subscribe_toggle_spinner($stream_row);
    }
    return channel.post({
        url: "/json/users/me/subscriptions",
        data: {subscriptions: JSON.stringify([{name: stream, color}])},
        success(_resp, _statusText, xhr) {
            if (overlays.streams_open()) {
                $("#create_stream_name").val("");
            }

            const res = JSON.parse(xhr.responseText);
            if (!$.isEmptyObject(res.already_subscribed)) {
                // Display the canonical stream capitalization.
                true_stream_name = res.already_subscribed[people.my_current_email()][0];
                ui_report.success(
                    $t_html(
                        {defaultMessage: "Already subscribed to {stream}"},
                        {stream: true_stream_name},
                    ),
                    $(".stream_change_property_info"),
                );
            }
            // The rest of the work is done via the subscribe event we will get

            if ($stream_row !== undefined) {
                hide_subscribe_toggle_spinner($stream_row);
            }
        },
        error(xhr) {
            if ($stream_row !== undefined) {
                hide_subscribe_toggle_spinner($stream_row);
            }
            ui_report.error(
                $t_html({defaultMessage: "Error adding subscription"}),
                xhr,
                $(".stream_change_property_info"),
            );
        },
    });
}

function ajaxUnsubscribe(sub, $stream_row) {
    // TODO: use stream_id when backend supports it
    if ($stream_row !== undefined) {
        display_subscribe_toggle_spinner($stream_row);
    }
    return channel.del({
        url: "/json/users/me/subscriptions",
        data: {subscriptions: JSON.stringify([sub.name])},
        success() {
            $(".stream_change_property_info").hide();
            // The rest of the work is done via the unsubscribe event we will get

            if ($stream_row !== undefined) {
                hide_subscribe_toggle_spinner($stream_row);
            }
        },
        error(xhr) {
            if ($stream_row !== undefined) {
                hide_subscribe_toggle_spinner($stream_row);
            }
            ui_report.error(
                $t_html({defaultMessage: "Error removing subscription"}),
                xhr,
                $(".stream_change_property_info"),
            );
        },
    });
}

export function do_open_create_stream() {
    // Only call this directly for hash changes.
    // Prefer open_create_stream().

    const stream = $("#sku_search_stream_name").val().trim();

    if (!should_list_all_streams()) {
        // Realms that don't allow listing streams should simply be subscribed to.
        // stream_create.set_name(stream);
        ajaxSubscribe($("#sku_search_stream_name").val());
        return;
    }

    // stream_create.new_stream_clicked(stream);
}

export function open_create_stream() {
    do_open_create_stream();
    browser_history.update("#my-sku/new");
}

export function unsubscribe_from_private_stream(sub) {
    const invite_only = sub.invite_only;
    const sub_count = peer_data.get_subscriber_count(sub.stream_id);
    const stream_name_with_privacy_symbol_html = render_inline_decorated_stream_name({stream: sub});

    const html_body = render_unsubscribe_private_stream_modal({
        message: $t({
            defaultMessage: "Once you leave this stream, you will not be able to rejoin.",
        }),
        display_stream_archive_warning: sub_count === 1 && invite_only,
    });

    function unsubscribe_from_stream() {
        let $stream_row;
        if (overlays.streams_open()) {
            $stream_row = $(
                "#work_sku_overlay_container div.stream-row[data-stream-id='" + sub.stream_id + "']",
            );
        }

        ajaxUnsubscribe(sub, $stream_row);
    }

    confirm_dialog.launch({
        html_heading: $t_html(
            {defaultMessage: "Unsubscribe from <z-link></z-link>"},
            {"z-link": () => stream_name_with_privacy_symbol_html},
        ),
        html_body,
        on_click: unsubscribe_from_stream,
    });
}

export function sub_or_unsub(sub, $stream_row) {
    if (sub.subscribed) {
        // TODO: This next line should allow guests to access web-public streams.
        if (sub.invite_only || page_params.is_guest) {
            unsubscribe_from_private_stream(sub);
            return;
        }
        ajaxUnsubscribe(sub, $stream_row);
    } else {
        ajaxSubscribe(sub.name, sub.color, $stream_row);
    }
}

export function update_web_public_stream_privacy_option_state($container) {
    const $web_public_stream_elem = $container.find(
        `input[value='${CSS.escape(stream_data.stream_privacy_policy_values.web_public.code)}']`,
    );

    const for_stream_edit_panel = $container.attr("id") === "stream_permission_settings";
    if (for_stream_edit_panel) {
        const stream_id = Number.parseInt(
            $container.closest(".subscription_settings.show").attr("data-stream-id"),
            10,
        );
        const sub = sub_store.get(stream_id);
        if (!stream_data.can_change_permissions(sub)) {
            // We do not want to enable the already disabled web-public option
            // in stream-edit panel if user is not allowed to change stream
            // privacy at all.
            return;
        }
    }

    if (
        !page_params.server_web_public_streams_enabled ||
        !page_params.realm_enable_spectator_access
    ) {
        if (for_stream_edit_panel && $web_public_stream_elem.is(":checked")) {
            // We do not hide web-public option in the "Change privacy" modal if
            // stream is web-public already. The option is disabled in this case.
            $web_public_stream_elem.prop("disabled", true);
            return;
        }
        $web_public_stream_elem.closest(".settings-radio-input-parent").hide();
        $container
            .find(".stream-privacy-values .settings-radio-input-parent:visible")
            .last()
            .css("border-bottom", "none");
    } else {
        if (!$web_public_stream_elem.is(":visible")) {
            $container
                .find(".stream-privacy-values .settings-radio-input-parent:visible")
                .last()
                .css("border-bottom", "");
            $web_public_stream_elem.closest(".settings-radio-input-parent").show();
        }
        $web_public_stream_elem.prop(
            "disabled",
            !settings_data.user_can_create_web_public_streams(),
        );
    }
}

export function update_public_stream_privacy_option_state($container) {
    const $public_stream_elem = $container.find(
        `input[value='${CSS.escape(stream_data.stream_privacy_policy_values.public.code)}']`,
    );
    $public_stream_elem.prop("disabled", !settings_data.user_can_create_public_streams());
}

export function update_private_stream_privacy_option_state($container) {
    // Disable both "Private, shared history" and "Private, protected history" options.
    const $private_stream_elem = $container.find(
        `input[value='${CSS.escape(stream_data.stream_privacy_policy_values.private.code)}']`,
    );
    const $private_with_public_history_elem = $container.find(
        `input[value='${CSS.escape(
            stream_data.stream_privacy_policy_values.private_with_public_history.code,
        )}']`,
    );

    $private_stream_elem.prop("disabled", !settings_data.user_can_create_private_streams());
    $private_with_public_history_elem.prop(
        "disabled",
        !settings_data.user_can_create_private_streams(),
    );
}

export function hide_or_disable_stream_privacy_options_if_required($container) {
    update_web_public_stream_privacy_option_state($container);

    update_public_stream_privacy_option_state($container);

    update_private_stream_privacy_option_state($container);
}

export function update_stream_privacy_choices(policy) {
    if (!overlays.streams_open()) {
        return;
    }
    const stream_edit_panel_opened = $("#work_stream_permission_settings").is(":visible");
    const stream_creation_form_opened = $("#work_stream-creation").is(":visible");

    if (!stream_edit_panel_opened && !stream_creation_form_opened) {
        return;
    }
    let $container = $("#work_stream-creation");
    if (stream_edit_panel_opened) {
        $container = $("#work_stream_permission_settings");
    }

    if (policy === "create_private_stream_policy") {
        update_private_stream_privacy_option_state($container);
    }
    if (policy === "create_public_stream_policy") {
        update_public_stream_privacy_option_state($container);
    }
    if (policy === "create_web_public_stream_policy") {
        update_web_public_stream_privacy_option_state($container);
    }
}

export function show_loading() {
    const $spinner = $('#work_sku_overlay').find(".sub_unsub_status").expectOne();
    $spinner.show();
    loading.make_indicator($spinner);
}

export function hide_loading() {
    const $spinner = $('#work_sku_overlay').find(".sub_unsub_status").expectOne();
    $spinner.hide();
    loading.destroy_indicator($spinner);
}

// 计算总页数
export function calculateTotalPages(totalItems, itemsPerPage) {
    return Math.ceil(totalItems / itemsPerPage);
}

export async function render_my_sku_list(isReload) {
    show_loading();
    // For annoying legacy reasons we render all the subs we are
    // allowed to know about and put them in the DOM, then we do
    // a second pass where we filter/sort them.
    const { code, result: { list , pages, total} } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/sku/list?page=${mySkuPage}&size=${pageSize}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        const html = render_work_sku_list({
            skuList: list.length === 0 ? emptyList : list,
            isAll: list.length === 0
        });

        mySkuTotal = total;

        if(isReload) {
            scroll_util.get_content_element($("#work_sku_overlay .work-sku-list")).html(html);
        } else {
            scroll_util.get_content_element($("#work_sku_overlay .work-sku-list")).append(html);
        }

        hide_loading();
    }
}


function show_add_section() {
    $(".another-right").addClass("show");
    $(".subscriptions-header").addClass("slide-another-left");
    browser_history.update("#my-sku/new");
}



function display_cover_upload_complete() {
    $("#sku-cover-upload-widget .upload-spinner-background").css({visibility: "hidden"});
    $("#sku-cover-upload-widget .image-upload-text").show();
    $("#sku-cover-upload-widget .image-delete-button").show();
}

function display_cover_upload_started() {
    $("#sku-cover-source").hide();
    $("#sku-cover-upload-widget .upload-spinner-background").css({visibility: "visible"});
    $("#sku-cover-upload-widget .image-upload-text").hide();
    $("#sku-cover-upload-widget .image-delete-button").hide();
}

function upload_cover($file_input) {
    const form_data = new FormData();

    // for (const [i, file] of Array.prototype.entries.call($file_input[0].files)) {
    //     form_data.append("file-" + i, file);
    // }
    display_cover_upload_started();
    form_data.append('file', $file_input[0].files[0]);

    channel.post({
        url: "https://rpa.insfair.cn/zmtapi/member/uploadPicture",
        data: form_data,
        cache: false,
        processData: false,
        contentType: false,
        success({ result }) {
            $("#sku-cover-upload-widget .image-block").attr("src", result);
            display_cover_upload_complete();
            $("#sku-cover-upload-widget .image_file_input_error").hide();
            $("#sku-cover-source").hide();
            $("#sku-cover-upload-widget .image-box").hide();
            // Rest of the work is done via the user_events -> avatar_url event we will get
        },
        error(xhr) {
            display_cover_upload_complete();
            const $error = $("#sku-cover-upload-widget .image_file_input_error");
            $error.text(JSON.parse(xhr.responseText).msg);
            $error.show();
        },
    });
}

function display_img_list_upload_complete() {
    $("#sku-img-list-upload-widget .upload-spinner-background").css({visibility: "hidden"});
    $("#sku-img-list-upload-widget .image-upload-text").show();
    $("#sku-img-list-upload-widget .image-delete-button").show();
}

function display_img_list_upload_started() {
    $("#sku-img-list-source").hide();
    $("#sku-img-list-upload-widget .upload-spinner-background").css({visibility: "visible"});
    $("#sku-img-list-upload-widget .image-upload-text").hide();
    $("#sku-img-list-upload-widget .image-delete-button").hide();
}

function upload_img_list($file_input) {
    const form_data = new FormData();
    const $uploadWidget = $("#sku-img-list-upload-widget");
    const $container = $uploadWidget.closest('.sku-img-list-field');

    // 检查已上传的图片数量
    if ($container.find('.sku-img-item').length >= 10) {
        const $error = $("#sku-img-list-upload-widget .image_file_input_error");
        $error.text("最多只能上传10张图片");
        $error.show();
        $uploadWidget.hide();
        return;
    }

    display_img_list_upload_started();
    form_data.append('file', $file_input[0].files[0]);

    channel.post({
        url: "https://rpa.insfair.cn/zmtapi/member/uploadPicture",
        data: form_data,
        cache: false,
        processData: false,
        contentType: false,
        success({ result }) {
            display_img_list_upload_complete();
            const $imgWrapper = $('<div class="sku-img-item"><img src="' + result + '" /><i class="fa fa-times"></i></div>');

            $imgWrapper.insertBefore($uploadWidget);

            // 检查上传后的图片数量，如果达到10张则隐藏上传组件
            if ($container.find('.sku-img-item').length >= 10) {
                $uploadWidget.hide();
            }

            // 绑定删除事件
            $imgWrapper.find('.fa-times').on('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                $(this).closest('.sku-img-item').remove();
                // 当删除图片后，如果数量小于10，重新显示上传组件
                if ($container.find('.sku-img-item').length < 10) {
                    $uploadWidget.show();
                }
            });
        },
        error(xhr) {
            display_img_list_upload_complete();
            const $error = $("#sku-img-list-upload-widget .image_file_input_error");
            $error.text(JSON.parse(xhr.responseText).msg);
            $error.show();
        },
    });
}

function display_avatar_delete_complete() {
    $("#sku-cover-upload-widget .upload-spinner-background").css({visibility: "hidden"});
    $("#sku-cover-upload-widget .image-upload-text").show();
    $("#sku-cover-source").show();
}

function display_avatar_delete_started() {
    $("#sku-cover-upload-widget .upload-spinner-background").css({visibility: "visible"});
    $("#sku-cover-upload-widget .image-upload-text").hide();
    $("#sku-cover-upload-widget .image-delete-button").hide();
}

export function build_sku_cover_widget(upload_function) {
    const get_file_input = function () {
        return $("#sku-cover-upload-widget .image_file_input").expectOne();
    };

    if (page_params.avatar_source === "G") {
        $("#sku-cover-upload-widget .image-delete-button").hide();
        $("#sku-cover-source").show();
    } else {
        $("#sku-cover-source").hide();
    }

    $("#sku-cover-upload-widget .image-delete-button").on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#sku-cover-upload-widget .image-block").attr("src", '');
        $("#sku-cover-upload-widget .image-box").show();
    });

    return upload_widget.build_direct_upload_widget(
        get_file_input,
        $("#sku-cover-upload-widget .image_file_input_error").expectOne(),
        $("#sku-cover-upload-widget .image_upload_button").expectOne(),
        upload_function,
        page_params.max_avatar_file_size_mib,
    );
}

export function build_sku_img_list_widget(upload_function) {
    const get_file_input = function () {
        return $("#sku-img-list-upload-widget .image_file_input").expectOne();
    };

    if (page_params.avatar_source === "G") {
        $("#sku-img-list-upload-widget .image-delete-button").hide();
        $("#sku-img-list-source").show();
    } else {
        $("#sku-img-list-source").hide();
    }

    $("#sku-img-list-upload-widget .image-delete-button").on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#sku-img-list-upload-widget .image-block").attr("src", '');
        $("#sku-img-list-upload-widget .image-box").show();
    });

    return upload_widget.build_direct_upload_widget(
        get_file_input,
        $("#sku-img-list-upload-widget .image_file_input_error").expectOne(),
        $("#sku-img-list-upload-widget .image_upload_button").expectOne(),
        upload_function,
        page_params.max_avatar_file_size_mib,
    );
}



export function initialize() {
    $("#work_sku_overlay_container").on("click", ".create_sku_button", (e) => {
        e.preventDefault();
        show_add_section();
    });

    $("#work_sku_overlay_container").on("click", "#work_stream_creation_form [data-dismiss]", (e) => {
        e.preventDefault();
        // we want to make sure that the click is not just a simulated
        // click; this fixes an issue where hitting "Enter" would
        // trigger this code path due to bootstrap magic.
        if (e.clientY !== 0) {
            work_sku_edit.open_edit_panel_empty();
        }
    });

    $("#work_sku_overlay_container").on("click", ".email-address", function () {
        selectText(this);
    });

    // $("#work_sku_overlay_container").on(
    //     "click",
    //     ".stream-row, .create_stream_button",
    //     show_right_section,
    // );

    $("#work_sku_overlay_container").on("click", ".fa-chevron-left", () => {
        $(".right").removeClass("show");
        $(".subscriptions-header").removeClass("slide-left");

        $(".another-right").removeClass("show");
        $(".subscriptions-header").removeClass("slide-another-left");

        browser_history.update("#my-sku");
    });

    $("#work_sku_overlay_container").on("click", ".sku-item", (e) => {
        const id = $(e.currentTarget).data('id');
        show_right_section(id);
    });

    $("#work_sku_overlay_container").on("click", "#create_sku", (e) => {
        e.preventDefault();

        // 获取表单数据
        const $form = $(".work-sku-form");
        const skuName = $form.find(".sku_name").val().trim();
        const skuPic = $("#sku-cover-upload-widget .image-block").attr("src") || "";
        const skuImgList = [];

        // 获取详情图列表
        $(".sku-img-list-field .sku-img-item img").each(function() {
            const imgSrc = $(this).attr("src");
            if (imgSrc) {
                skuImgList.push(imgSrc);
            }
        });

        // 清除之前的错误提示
        $form.find(".custom-field-status").empty().hide();

        // 验证表单
        if (!skuName) {
            $form.find(".sku_name")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入商品服务名称")
                .show();
            return;
        }

        if (!skuPic) {
            $form.find("#sku-cover-upload-widget")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请上传商品服务主图")
                .show();
            return;
        }

        // 构造请求数据
        const data = {
            skuName,
            skuPic,
            skuUrl: JSON.stringify(skuImgList),
            uid: page_params.user_id
        };

        // 发送请求
        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/sku/add",
            contentType: "application/json",
            data: JSON.stringify(data),
            success({code, result, message}) {

                if(code === 200) {
                    // 清空表单
                    $form.find(".sku_name").val("");
                    $("#sku-cover-upload-widget .image-block").attr("src", "");
                    $("#sku-cover-upload-widget .image-box").show();
                    $(".sku-img-list-field .sku-img-item").remove();
                    $("#sku-img-list-upload-widget").show();

                    // 显示成功提示
                    dialog_widget.launch({
                        html_heading: $t_html({defaultMessage: "创建成功"}),
                        html_body: $t_html({defaultMessage: "商品服务已成功创建"}),
                        html_submit_button: $t_html({defaultMessage: "确定"}),
                        on_hidden: () => {
                            e.preventDefault();
                            // 重新加载列表
                            mySkuPage = 1;
                            render_my_sku_list(true);

                            // 返回列表页
                            $(".another-right").removeClass("show");
                            $(".subscriptions-header").removeClass("slide-another-left");
                            browser_history.update("#my-sku");
                        },
                        close_on_escape: true,
                        single_footer_button: true,
                        help_link: "",
                    });
                } else {
                    // 显示错误信息
                    dialog_widget.launch({
                        html_heading: $t_html({defaultMessage: "创建失败"}),
                        html_body: message,
                        close_on_escape: true,
                        single_footer_button: true,
                        help_link: "",
                    });
                }
            },
            error(xhr) {
                // 显示错误信息
                const error_message = xhr.responseJSON?.message || $t({defaultMessage: "未知错误"});
                dialog_widget.launch({
                    html_heading: $t_html({defaultMessage: "创建失败"}),
                    html_body: error_message,
                    close_on_escape: true,
                    single_footer_button: true,
                    help_link: "",
                });
            }
        });
    });

}
