import {parseISO} from "date-fns";
import $ from "jquery";

import render_user_group_list_item from "../templates/user_group_list_item.hbs";
import render_user_profile_modal from "../templates/user_profile_modal.hbs";
import render_user_stream_list_item from "../templates/user_stream_list_item.hbs";
import render_youfang_message from "../templates/youfang_message.hbs";
import render_new_user_profile_top from "../templates/new_user_profile_top.hbs";
import render_new_user_profile_content from "../templates/new_user_profile_content.hbs";
import render_work_sku_info from "../templates/stream_settings/work_sku_info.hbs";

import * as browser_history from "./browser_history";
import * as buddy_data from "./buddy_data";
import * as channel from "./channel";
import * as components from "./components";
import * as hash_util from "./hash_util";
import {$t, $t_html} from "./i18n";
import * as ListWidget from "./list_widget";
import * as narrow from "./narrow";
import * as overlays from "./overlays";
import {page_params} from "./page_params";
import * as people from "./people";
import * as popovers from "./popovers";
import * as settings_account from "./settings_account";
import * as settings_bots from "./settings_bots";
import * as settings_config from "./settings_config";
import * as settings_profile_fields from "./settings_profile_fields";
import * as stream_data from "./stream_data";
import * as sub_store from "./sub_store";
import * as subscriber_api from "./subscriber_api";
import * as timerender from "./timerender";
import * as ui_report from "./ui_report";
import * as user_groups from "./user_groups";
import * as user_pill from "./user_pill";
import * as util from "./util";

function compare_by_name(a, b) {
    return util.strcmp(a.name, b.name);
}

function initialize_bot_owner(element_id, bot_id) {
    const user_pills = new Map();
    const bot = people.get_by_user_id(bot_id);
    const bot_owner = people.get_bot_owner_user(bot);
    // Bot owner's pill displaying on bot's profile modal.
    if (bot_owner) {
        const $pill_container = $(element_id)
            .find(
                `.bot_owner_user_field[data-field-id="${CSS.escape(
                    bot_owner.user_id,
                )}"] .pill-container`,
            )
            .expectOne();
        const pills = user_pill.create_pills($pill_container);

        user_pill.append_user(bot_owner, pills);
        user_pills.set(bot_owner.user_id, pills);
    }
    return user_pills;
}

function format_user_stream_list_item(stream, user) {
    const show_unsubscribe_button =
        people.can_admin_user(user) || stream_data.can_unsubscribe_others(stream);
    const show_private_stream_unsub_tooltip =
        people.is_my_user_id(user.user_id) && stream.invite_only;
    return render_user_stream_list_item({
        name: stream.name,
        stream_id: stream.stream_id,
        stream_color: stream.color,
        invite_only: stream.invite_only,
        is_web_public: stream.is_web_public,
        show_unsubscribe_button,
        show_private_stream_unsub_tooltip,
        stream_edit_url: hash_util.stream_edit_url(stream),
    });
}

function format_user_group_list_item(group) {
    return render_user_group_list_item({
        group_id: group.id,
        name: group.name,
        description: group.description,
    });
}

function render_user_stream_list(streams, user) {
    streams.sort(compare_by_name);
    const $container = $("#user-profile-modal .user-stream-list");
    $container.empty();
    ListWidget.create($container, streams, {
        name: `user-${user.user_id}-stream-list`,
        modifier(item) {
            return format_user_stream_list_item(item, user);
        },
        filter: {
            $element: $("#user-profile-streams-tab .stream-search"),
            predicate(item, value) {
                return item && item.name.toLocaleLowerCase().includes(value);
            },
        },
        $simplebar_container: $("#user-profile-modal .modal__body"),
    });
}

function render_user_group_list(groups, user) {
    groups.sort(compare_by_name);
    const $container = $("#user-profile-modal .user-group-list");
    $container.empty();
    ListWidget.create($container, groups, {
        name: `user-${user.user_id}-group-list`,
        modifier(item) {
            return format_user_group_list_item(item);
        },
        $simplebar_container: $("#user-profile-modal .modal__body"),
    });
}

export function get_custom_profile_field_data(user, field, field_types) {
    const field_value = people.get_custom_profile_data(user.user_id, field.id);
    const field_type = field.type;
    const profile_field = {};

    if (!field_value) {
        return profile_field;
    }
    if (!field_value.value) {
        return profile_field;
    }
    profile_field.id = field.id;
    profile_field.name = field.name;
    profile_field.is_user_field = false;
    profile_field.is_link = field_type === field_types.URL.id;
    profile_field.is_external_account = field_type === field_types.EXTERNAL_ACCOUNT.id;
    profile_field.type = field_type;
    profile_field.display_in_profile_summary = field.display_in_profile_summary;

    switch (field_type) {
        case field_types.DATE.id:
            profile_field.value = timerender.get_localized_date_or_time_for_format(
                parseISO(field_value.value),
                "dayofyear_year",
            );
            break;
        case field_types.USER.id:
            profile_field.is_user_field = true;
            profile_field.value = field_value.value;
            break;
        case field_types.SELECT.id: {
            const field_choice_dict = JSON.parse(field.field_data);
            profile_field.value = field_choice_dict[field_value.value].text;
            break;
        }
        case field_types.SHORT_TEXT.id:
        case field_types.LONG_TEXT.id:
            profile_field.value = field_value.value;
            profile_field.rendered_value = field_value.rendered_value;
            break;
        case field_types.EXTERNAL_ACCOUNT.id:
            profile_field.value = field_value.value;
            profile_field.field_data = JSON.parse(field.field_data);
            profile_field.subtype = profile_field.field_data.subtype;
            profile_field.link = settings_profile_fields.get_external_account_link(profile_field);
            break;
        default:
            profile_field.value = field_value.value;
    }
    return profile_field;
}

export function hide_user_profile() {
    overlays.close_modal_if_open("user-profile-modal");
}

function initialize_user_type_fields(user) {
    // Avoid duplicate pill fields, by removing existing ones.
    $("#user-profile-modal .pill").remove();
    if (!user.is_bot) {
        settings_account.initialize_custom_user_type_fields(
            "#user-profile-modal #content",
            user.user_id,
            false,
            false,
        );
    } else {
        initialize_bot_owner("#user-profile-modal #content", user.user_id);
    }
}

export async function show_user_profile(user, default_tab_key = "profile-tab") {
    popovers.hide_all();

    const field_types = page_params.custom_profile_field_types;
    const profile_data = page_params.custom_profile_fields
        .map((f) => get_custom_profile_field_data(user, f, field_types))
        .filter((f) => f.name !== undefined);
    const user_streams = stream_data.get_subscribed_streams_for_user(user.user_id);
    const groups_of_user = user_groups.get_user_groups_of_user(user.user_id);
    const spectator_view = page_params.is_spectator;
    const is_active = people.is_active_user_for_popover(user.user_id);
    const is_me = people.is_my_user_id(user.user_id);

    const args = {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.delivery_email,
        profile_data,
        user_avatar: people.medium_avatar_url_for_person(user),
        is_me: people.is_current_user(user.email),
        is_bot: user.is_bot,
        date_joined: timerender.get_localized_date_or_time_for_format(
            parseISO(user.date_joined),
            "dayofyear_year",
        ),
        user_circle_class: buddy_data.get_user_circle_class(user.user_id),
        last_seen: buddy_data.user_last_seen_time_status(user.user_id),
        user_time: people.get_user_time(user.user_id),
        user_type: people.get_user_type(user.user_id),
        user_is_guest: user.is_guest,
        groups_of_user,
        spectator_view,
        can_send_private_message:
            is_active &&
            !is_me &&
            page_params.realm_private_message_policy !==
                settings_config.private_message_policy_values.disabled.code,
        private_message_class: "compose_private_message",
        pm_with_url: hash_util.pm_with_url(user.email),
        sent_by_url: hash_util.by_sender_url(user.email),
        user_mention_syntax: people.get_mention_syntax(user.full_name, user.user_id)
    };

    if (user.is_bot) {
        const is_system_bot = user.is_system_bot;
        const bot_owner_id = user.bot_owner_id;
        if (is_system_bot) {
            args.is_system_bot = is_system_bot;
        } else if (bot_owner_id) {
            const bot_owner = people.get_by_user_id(bot_owner_id);
            args.bot_owner = bot_owner;
        }
        args.bot_type = settings_bots.type_id_to_string(user.bot_type);
    }

    $("#user-profile-modal-holder").html(render_user_profile_modal(args));
    overlays.open_modal("user-profile-modal", {autoremove: true});
    $(".tabcontent").hide();

    get_youfang_message(user);
    get_user_profile_detail(user);

    let default_tab = 0;
    // Only checking this tab key as currently we only open this tab directly
    // other than profile-tab.
    if (default_tab_key === "user-profile-streams-tab") {
        default_tab = 1;
    }

    const opts = {
        selected: default_tab,
        child_wants_focus: true,
        values: [
            {label: $t({defaultMessage: "Profile"}), key: "profile-tab"},
            {label: $t({defaultMessage: "Streams"}), key: "user-profile-streams-tab"},
            {label: $t({defaultMessage: "User groups"}), key: "user-profile-groups-tab"},
        ],
        callback(name, key) {
            $(".tabcontent").hide();
            $(`#${CSS.escape(key)}`).show();
            switch (key) {
                case "profile-tab":
                    initialize_user_type_fields(user);
                    break;
                case "user-profile-groups-tab":
                    render_user_group_list(groups_of_user, user);
                    break;
                case "user-profile-streams-tab":
                    render_user_stream_list(user_streams, user);
                    break;
            }
        },
    };

    const $elem = components.toggle(opts).get();
    $elem.addClass("large allow-overflow");
    $("#tab-toggle").append($elem);
}

async function get_youfang_message(user) {
    let youfang_message = []
    const { code, result } = await channel.get({
        url: "https://rpa.insfair.cn/zmtapi/zmt/list?page=1&size=5&creator=" + user.user_id,
    });

    if(code === 200) {
        youfang_message = result.list
    }
    const rendered_youfang_message = render_youfang_message({
        youfang_message
    });

    $("#youfang_message_box").html(rendered_youfang_message);
}

async function get_user_news(userId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/news?page=1&size=4&zulipUid=${userId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取用户新闻失败:', error);
        return null;
    }
}

async function get_user_quanzhong(userId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/quanzhong?zulipUid=${userId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取用户权重失败:', error);
        return null;
    }
}

async function get_user_tezheng(userId, type) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/tezheng?type=${type}&zulipUid=${userId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取用户特征失败:', error);
        return null;
    }
}

async function get_user_tj(userId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/tj?zulipUid=${userId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取用户统计失败:', error);
        return null;
    }
}

async function get_user_info_list(userId) {
    try {
        const { code, result } = await channel.post({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/info/list?zulipUid=${userId}`,
        });
        return code === 200 ? result : null;
    } catch (error) {
        console.error('获取用户资料列表失败:', error);
        return null;
    }
}

async function get_user_sku_list(userId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/sku/list?page=1&size=4&zulipUid=${userId}`,
        });
        return code === 200 ? {sku_list: result.list, total: result.total} : null;
    } catch (error) {
        console.error('获取用户SKU列表失败:', error);
        return null;
    }
}

async function get_user_profile_detail(user) {
    const [news, quanzhong, person_tezheng, report_tezheng, tj, info_list, {sku_list, total}] = await Promise.all([
        get_user_news(user.user_id),
        get_user_quanzhong(user.user_id),
        get_user_tezheng(user.user_id, 1),
        get_user_tezheng(user.user_id, 2),
        get_user_tj(user.user_id),
        get_user_info_list(user.user_id),
        get_user_sku_list(user.user_id)
    ]);

    const top_profile = render_new_user_profile_top({
        news,
        tj
    });
    $(".new-avatar-info-box").html(top_profile);

    person_tezheng.forEach((item) => {
        item.isTop = parseInt(item.rank) <= 10;
    });
    report_tezheng.forEach((item) => {
        item.isTop = parseInt(item.rank) <= 10;
    });

    const content_profile = render_new_user_profile_content({
        quanzhong,
        person_tezheng,
        report_tezheng,
        info_list,
        sku_list,
        total
    });
    $(".new-intro-content").html(content_profile);
}


function handle_remove_stream_subscription(target_user_id, sub, success, failure) {
    if (people.is_my_user_id(target_user_id)) {
        // Self unsubscribe.
        channel.del({
            url: "/json/users/me/subscriptions",
            data: {subscriptions: JSON.stringify([sub.name])},
            success,
            error: failure,
        });
    } else {
        subscriber_api.remove_user_id_from_stream(target_user_id, sub, success, failure);
    }
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


async function show_user_sku_section(id) {
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

        $("#user_sku_info_tem").html(html);
    }

    $(".user-sku-info-right").addClass("show");
    $(".user-sku-info-header").addClass("show");
}

export function register_click_handlers() {
    $("body").on("click", ".info_popover_actions .view_full_user_profile", (e) => {
        const user_id = popovers.elem_to_user_id($(e.target).parents("ul"));
        const user = people.get_by_user_id(user_id);
        show_user_profile(user);
        e.stopPropagation();
        e.preventDefault();
    });

    $("body").on("click", ".nav-item .narrow_to_messages_sent", (e) => {
        const user_id = popovers.elem_to_user_id($(e.target).parents("ul"));
        const email = people.get_by_user_id(user_id).email;
        popovers.hide_all();
        if (overlays.is_active()) {
            overlays.close_active();
        }
        narrow.by("sender", email, {trigger: "user sidebar popover"});
        $('.modal__close').trigger('click');
        e.stopPropagation();
        e.preventDefault();
    });

    $("body").on("click", ".nav-item .narrow_to_private_messages", (e) => {
        const user_id = popovers.elem_to_user_id($(e.target).parents("ul"));
        const email = people.get_by_user_id(user_id).email;
        popovers.hide_all();
        if (overlays.is_active()) {
            overlays.close_active();
        }
        narrow.by("dm", email, {trigger: "user sidebar popover"});
        $('.modal__close').trigger('click');
        e.stopPropagation();
        e.preventDefault();
    });

    $("body").on("click", "#user-profile-modal .remove-subscription-button", (e) => {
        e.preventDefault();
        const $stream_row = $(e.currentTarget).closest("[data-stream-id]");
        const stream_id = Number.parseInt($stream_row.attr("data-stream-id"), 10);
        const sub = sub_store.get(stream_id);
        const target_user_id = Number.parseInt(
            $stream_row.closest("#user-profile-modal").attr("data-user-id"),
            10,
        );
        const $alert_box = $("#user-profile-streams-tab .stream_list_info");

        function removal_success(data) {
            if (data.removed.length > 0) {
                // Most of the work for handling the unsubscribe is done
                // by the subscription -> remove event we will get.
                // However, the user profile component has not yet
                // implemented live update, so we do update its
                // UI manually here by removing the stream from this list.
                $stream_row.remove();

                ui_report.success(
                    $t_html({defaultMessage: "Unsubscribed successfully!"}),
                    $alert_box,
                    1200,
                );
            } else {
                ui_report.client_error(
                    $t_html({defaultMessage: "Already not subscribed."}),
                    $alert_box,
                    1200,
                );
            }
        }

        function removal_failure() {
            let error_message;
            if (people.is_my_user_id(target_user_id)) {
                error_message = $t(
                    {defaultMessage: "Error in unsubscribing from #{stream_name}"},
                    {stream_name: sub.name},
                );
            } else {
                error_message = $t(
                    {defaultMessage: "Error removing user from #{stream_name}"},
                    {stream_name: sub.name},
                );
            }

            ui_report.client_error(error_message, $alert_box, 1200);
        }

        if (sub.invite_only && people.is_my_user_id(target_user_id)) {
            const new_hash = hash_util.stream_edit_url(sub);
            hide_user_profile();
            browser_history.go_to_location(new_hash);
            return;
        }
        handle_remove_stream_subscription(target_user_id, sub, removal_success, removal_failure);
    });

    $("body").on("click", "#user-profile-modal #clear_stream_search", (e) => {
        const $input = $("#user-profile-streams-tab .stream-search");
        $input.val("");

        // This is a hack to rerender complete
        // stream list once the text is cleared.
        $input.trigger("input");

        e.stopPropagation();
        e.preventDefault();
    });
    /* These click handlers are implemented as just deep links to the
     * relevant part of the Zulip UI, so we don't want preventDefault,
     * but we do want to close the modal when you click them. */
    $("body").on("click", "#user-profile-modal #name .user_profile_edit_button", () => {
        hide_user_profile();
    });

    $("body").on("click", "#user-profile-modal .stream_list_item", () => {
        hide_user_profile();
    });

    $("body").on("click", "#user-profile-modal .show-profile-sku-detail", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const $target = $(e.currentTarget);
        const skuId = $target.data("sku-id");
        show_user_sku_section(skuId);
    });

    $("body").on("click", "#user-profile-modal .fa-chevron-left", () => {
        $(".user-sku-info-right").removeClass("show");
        $(".user-sku-info-header").removeClass("show");
    });

    $("body").on("input", "#user-profile-streams-tab .stream-search", () => {
        const $input = $("#user-profile-streams-tab .stream-search");
        if ($input.val().trim().length > 0) {
            $("#user-profile-streams-tab #clear_stream_search").show();
            $input.css("margin-right", "-20px");
        } else {
            $("#user-profile-streams-tab #clear_stream_search").hide();
            $input.css("margin-right", "0");
        }
    });
}
