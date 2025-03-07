import $ from "jquery";

import render_user_work_order_modal from "../templates/user_work_order_modal.hbs";
import render_user_work_item from "../templates/user_work_item.hbs";
import render_user_work_detail from "../templates/user_work_detail.hbs";
import render_user_work_feedback from "../templates/user_work_feedback.hbs";
import render_user_work_excep from "../templates/user_work_excep.hbs";
import render_user_work_sku_item from "../templates/user_work_sku_item.hbs";
import render_user_work_join_member_item from "../templates/user_work_join_member_item.hbs";
import render_user_work_join_member_material_item from "../templates/user_work_join_member_material_item.hbs";

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
import * as loading from "./loading";
import * as scroll_util from "./scroll_util";
import * as moment from 'moment';
import * as dialog_widget from "./dialog_widget";
import {insert} from "text-field-edit";
import 'jquery-countdown';

export function launch() {
    $("#user-work-order-modal-holder").html(render_user_work_order_modal());
    overlays.open_modal("user-work-order-modal", {autoremove: true, on_close: browser_history.exit_overlay});
}

export function initialize() {
    const rendered_about_zulip = render_user_work_order_modal({
        zulip_version: page_params.zulip_version,
        zulip_merge_base: page_params.zulip_merge_base,
        is_fork:
            page_params.zulip_merge_base &&
            page_params.zulip_merge_base !== page_params.zulip_version,
    });
    $("#user-work-order-modal-holder").append(rendered_about_zulip);
}

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
        url: "https://rpa.insfair.cn/zmtapi/zmt/list?page=1&size=5&zulipUid=" + user.user_id,
    });

    if(code === 200) {
        youfang_message = result.list
    }
    const rendered_youfang_message = render_youfang_message({
        youfang_message
    });

    $("#youfang_message_box").html(rendered_youfang_message);
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

async function get_gongdan_user_list_two(id) {
    const { code, result } = await channel.get({
        url: "https://rpa.insfair.cn/zmtapi/gongdan/user/list?page=1&size=2&id=" + id,
    });
    if(code === 200) {
        const html = render_user_work_join_member_item({
            user_list: result.list,
            isAll: result.list.length === 0,
        });
        $("#join-member-list").html(html);

        return result.list
    }
}

async function get_gongdan_tongji(id) {
    const { code, result: {
        toCheck, toFeedback, toReply
    } } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/tj?id=${id}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        if(!toCheck && !toFeedback && !toReply) {
            return;
        }
        $('.join-member-status-tongji').html(`
           （${toCheck ? '待审核' + toCheck : ''}${toFeedback ? '待反馈' + toFeedback : ''}${toReply ? '异常待处理' + toReply : ''}）
        `);
    }
}

async function get_gongdan_user_list(id) {
    const { code, result } = await channel.get({
        url: "https://rpa.insfair.cn/zmtapi/gongdan/user/list?page=1&size=20&id=" + id,
    });
    if(code === 200) {
        const memberHtml = result.list.map(user => `
            <div class="member">
                <div class="member-avatar" style="background-image: url('${user.photo}');"></div>
            </div>
        `).join('');

        $("#gongdan-join-member-list").html(memberHtml);
    }
}

async function get_my_url_list(taskId) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gd/url/list?page=1&size=100&id=${taskId}&zulipUid=${page_params.user_id}`,
    });
    if(code === 200 && result.list && result.list.length > 0) {
        $('.submit-material-button').html('补充提交');
        const urlItems = result.list.map(item => `
            <div class="material-url-item">
                <a href="${item.url}" target="_blank">${item.url}</a>
            </div>
        `).join('');

        $(".material-url-box").html(urlItems);
    }
}

async function get_my_join_info(id, endTime) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/self?id=${id}&zulipUid=${page_params.user_id}`,
    });
    if(code === 200 && result) {
        $('.join-button').hide();
        if(moment(endTime).valueOf() <= moment().valueOf()) {
            $('.material-count-down-box').html('提交已截止');
            $('.material-input-box').hide();
            $('.add-new-btn-box').hide();
            $('.submit-material-button').hide();
        } else {
            $('.material-count-down-box').countdown(endTime, function(event) {
                $(this).html(event.strftime(
                    `剩余 &nbsp; %D:%H:%M:%S`
                ));
            }).on('finish.countdown', function() {
                $(this).html('提交已截止');
                $('.material-input-box').hide();
                $('.add-new-btn-box').hide();
                $('.submit-material-button').hide();
            });
        }
        return result.id;
    } else {
        $('.material-handler-content').hide();
        return false;
    }
}

async function get_my_join_status(id) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/self?id=${id}&zulipUid=${page_params.user_id}`,
    });
    if(code === 200 && result) {
        if(result.statusException) {
            $('.user-work-join-status').addClass(
                result.statusException == 2 ? 'blue' :
                result.statusException == 3 ? 'green' : 'red'
            ).html(
                result.timeoutTag == 1 ? '异常超时后未回复' :
                result.statusException == 1 ? '异常未回复' :
                result.statusException == 2 ? '已回复待确认' :
                result.statusException == 3 ? '已解决' :
                result.statusException == 4 ? '异常未解决' : '发生异常，请联系管理员'
            );

            if(result.timeoutTag == 1 && result.excepCreater != page_params.user_id) {
                $(".excep-text-status").html('对方超时未处理，你可以继续选择公示异常');
            } else if(result.timeoutTag == 1 && result.excepCreater == page_params.user_id) {
                $(".excep_has_timeout_join").show();
            } else if(result.statusException == 1) {
                $(".excep-text-status").html(result.excepCreater == page_params.user_id ? '等待对方说明异常情况...' : '等待你说明异常情况...');
            } else if(result.statusException == 2) {
                $(".excep-text-status").html(result.excepCreater == page_params.user_id ? '对方更新了异常说明' : '你更新了异常说明');
            }

            if(result.statusException) {
                $('.report-material-button').hide();
                $('.show-report-button').attr('data-excep-status', result.statusException);
            } else {
                $('.show-report-button').show();
            }
        } else {
            $('.user-work-join-status').addClass(
                result.status == 0 ? 'yellow' :
                result.status == 1 ? 'green' :
                result.status == 2 ? 'yellow' :
                result.status == 3 ? 'yellow' :
                result.status == 4 ? 'red' :
                result.status == 5 ? 'blue' :
                result.status == 6 ? 'red' : 'red'
            ).html(
                result.status == 0 ? '已参与，待提交素材' :
                result.status == 1? '已提交素材，待审核' :
                result.status == 2? '审核中' :
                result.status == 3? '审核完成 待反馈' :
                result.status == 4? '审核不通过' :
                result.status == 5? '已反馈 工单完成' :
                result.status == 6? '过期未反馈' :
                result.status == 7? '超时未提交素材' : '发生异常，请联系管理员'
            );

            if(result.status == 3) {
                $('.material-input-box').hide();
                $('.add-new-btn-box').hide();
                $('.material-handler-buttons').hide();
                $('.feedback-handler-box').css('display', 'flex');
                $('.feedback-handler-box .show-feedback-button').hide();
            } else if(result.status == 5) {
                $('.material-input-box').hide();
                $('.add-new-btn-box').hide();
                $('.material-handler-buttons').hide();
                $('.feedback-handler-box').css('display', 'flex');
                $('.feedback-handler-box .feedback-button').hide();
            }
            $('.show-report-button').hide();
        }
    }
}

async function get_feedback_list(taskId) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gd/feedback/list?page=1&size=100&id=${taskId}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200 && result.list && result.list.length > 0) {
        return result.list[0].id
    }
}

async function get_excep_list(taskId) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gd/exception/list?page=1&size=100&id=${taskId}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200 && result.list && result.list.length > 0) {
        if(!result.list[0].statusException) {
            $(".excep_no_reply").show();
            $(".excep_has_reply").hide();

            if(result.list[0].timeToReplay && (moment().valueOf() > result.list[0].timeToReplay)) {
                $(".excep_has_reply").show();
                $(".excep_no_reply").hide();
                $(".excep_has_reply").find(".status_title").html('对方超时未处理');
                $(".excep_has_reply").find(".status_label").html(`对方未在 ${moment(result.list[0].replyDate).format("YYYY-MM-DD HH:mm:ss")} 前及时处理异常`);
                $("#excep_close_btn").hide();
            } else {
                const endTime = result.list[0].timeToReplay ? moment(result.list[0].timeToReplay).format('YYYY-MM-DD HH:mm:ss') : moment(result.list[0].created).add(48, 'hours').format('YYYY-MM-DD HH:mm:ss');

                if(result.list[0].type === 0) {
                    $(".excep_no_reply_creater").show();
                    $(".excep_no_reply_join").hide();
                    $("#submit-reply-excep-btn").attr('data-excep-id', result.list[0].id);
                } else {
                    $(".excep_no_reply_creater").hide();
                    $(".excep_no_reply_join").show();
                }
                $('.excep_status_countdown').countdown(endTime, function(event) {
                    $(this).html(event.strftime(
                        `%D:%H:%M:%S`
                    ));
                });
            }
        } else {
            if(result.list[0].type === 1) {
                $(".excep_has_reply").show();
                $(".excep_no_reply").hide();
                $(".excep_reply_time").html(moment(result.list[0].replyDate).format("YYYY-MM-DD HH:mm:ss"));

                const excepTypeMap = {
                    1: '工单失效',
                    2: '条件变化',
                    3: '付款纠纷',
                    4: '故意不通过',
                    5: '其他类型'
                };
                $(".excep_reply_tag").html(excepTypeMap[result.list[0].typeExcep] || '');
                $(".excep_reply_text").html(result.list[0].reply);
                $("#excep_close_btn").attr('data-excep-id', result.list[0].id);
            } else if(result.list[0].type === 0) {
                $(".excep_has_reply").hide();
                $(".excep_no_reply").hide();
                $("#reply-excep-url-input").val(result.list[0].reply);
            }
        }

        return result.list[0].id
    }
}

async function set_feedback_form(feedbackId) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gd/feedback/detail?id=${feedbackId}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        $("#feedback-money-input").val(result.money);
        $("#feedback-url-input").val(result.url);

        // 处理创建者特征标签
        const createrTags = result.cate ? result.cate.split(',') : [];
        // 处理商品特征标签
        const skuTags = result.cateGood ? result.cateGood.split(',') : [];

        // 遍历所有标签，匹配并添加选中状态
        $('.feedback-tag').each(function() {
            const $tag = $(this);
            const tagValue = $tag.data('value');
            const tagType = $tag.data('type');

            if (
                (tagType === 'creater' && createrTags.includes(tagValue)) ||
                (tagType === 'sku' && skuTags.includes(tagValue))
            ) {
                $tag.addClass('selected');
            }
        });
    }
}

async function set_excep_form(reportId, isFromList) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gd/exception/detail?id=${reportId}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        $("#excep-money-input").val(result.money);
        $("#excep-url-input").val(result.url);

        $('.excep-tag').each(function() {
            const $tag = $(this);
            const tagValue = $tag.data('value');

            // 判断是否匹配异常类型
            if (Number(tagValue) === result.typeExcep) {
                $tag.addClass('selected');
            }
        });

        if(result.type == 1) {
            if(result.statusException == 3) {
                $('.excep_status_buttons').html('你选择了双方已解决此异常');
            } else if(result.statusException == 2) {
            }
        } else if(result.type == 0) {
            $(".excep_no_reply_join").hide();
            if(result.user == page_params.user_id)
                $(".excep_no_reply_creater .status_title, .excep_no_reply_creater .status_label").hide();

            if(isFromList) {

                if(result.statusException) $(".excep_has_reply").show();
                else $(".excep_no_reply_join").show();

                $(".excep_no_reply_creater").hide();
                $(".excep_reply_text").html(result.reply);
                if(result.statusException == 2) {
                    $("#excep_close_btn").attr('data-excep-id', result.id);
                    $("#excep_close_btn").attr('data-form-list', true);
                } else if(result.statusException == 3) {
                    $("#excep_close_btn").closest(".excep_status_buttons").html("你选择了双方已解决此异常");
                }
            } else {
                if(result.statusException == 3) {
                    $("#submit-reply-excep-btn").closest(".custom_user_field").html('对方已确认解决了此异常');
                } else if(result.statusException == 2) {
                    $("#submit-reply-excep-btn").closest(".custom_user_field").html('等待报告方确认解决...');
                } else if(result.statusException == 4) {
                    $("#submit-reply-excep-btn").closest(".custom_user_field").html('对方认为此异常为解决');
                }
            }
        }
    }
}

async function set_sku_recommond_list(skuId) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/sku/tezheng/recommond?skuId=${skuId}`,
        });

        if (code === 200 && result) {
            const tags = result.map(item => `
                <span class="feedback-tag" data-type="sku" data-value="${item.tz}">${item.tz}</span>
            `).join('');

            $('.feedback-tags-box').append(tags);
        }
    } catch (error) {
        console.error('获取SKU特征推荐失败:', error);
    }
}

async function set_person_recommond_list(zulipUid) {
    try {
        const { code, result } = await channel.get({
            url: `https://rpa.insfair.cn/zmtapi/zulip/user/tezheng/recommond?zulipUid=${zulipUid}`,
        });

        if (code === 200 && result) {
            const tags = result.map(item => `
                <span class="feedback-tag" data-type="creater" data-value="${item.tz}">${item.tz}</span>
            `).join('');

            $('.feedback-tags-box').append(tags);
        }
    } catch (error) {
        console.error('获取用户特征推荐失败:', error);
    }
}

async function show_feedback_section(id, isShowDetail, taskId, isFromList, joinUserId) {
    show_loading();
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/detail?id=${id}&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        result.endTime = moment(result.endTime).format("YYYY-MM-DD HH:mm:ss");
        const isMycreated = result.creater == page_params.user_id
        const user = people.get_by_user_id(parseInt(isFromList ? joinUserId : result.creater));

        const [quanzhong, person_tezheng, report_tezheng, tj, skuTezheng] = await Promise.all([
            get_user_quanzhong(isFromList ? joinUserId : result.creater),
            get_user_tezheng(isFromList ? joinUserId : result.creater, 1),
            get_user_tezheng(isFromList ? joinUserId : result.creater, 2),
            get_user_tj(isFromList ? joinUserId : result.creater),
            get_sku_tezheng(id),
        ]);
        person_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });
        report_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });

        const html = render_user_work_feedback({
            detail: result,
            isMycreated,
            isShowDetail,
            creater: user,
            isFromList,
            quanzhong,
            person_tezheng,
            report_tezheng,
            tj,
            skuTezheng,
        });

        $("#feedback-detail").html(html);
        if(!isFromList) set_sku_recommond_list(result.skuId);
        else $("#submit-feedback-btn").attr("data-task-id", taskId);
        set_person_recommond_list(isFromList ? joinUserId : result.creater);

        if(isFromList) {
            $("#user-work-order-modal-holder .join-members-right").removeClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-join-members-left");
            $("#user-work-order-modal-holder .subscriptions-header .second-left").attr("data-from-list", true);
            $("#user-work-order-modal-holder .subscriptions-header .second-left").attr("data-task-id", taskId);
        } else {
            $("#user-work-order-modal-holder .right").removeClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-left");
        }


        $("#user-work-order-modal-holder .feedback-right").addClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-feedback-left");
        browser_history.update("#user-work/feedback/" + id);

        $(".second-left").attr("data-gongdan-id", id);

        if(isShowDetail) {
            const feedbackId = await get_feedback_list(taskId);
            set_feedback_form(feedbackId);
        }
        hide_loading();
    }
}

async function show_excep_section(id, isShowDetail, taskId, statusException, isFromList, joinUserId) {
    show_loading();
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/detail?id=${id}&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        result.endTime = moment(result.endTime).format("YYYY-MM-DD HH:mm:ss");
        const user = people.get_by_user_id(parseInt(isFromList ? joinUserId : result.creater));

        const [quanzhong, person_tezheng, report_tezheng, tj, skuTezheng] = await Promise.all([
            get_user_quanzhong(isFromList ? joinUserId : result.creater),
            get_user_tezheng(isFromList ? joinUserId : result.creater, 1),
            get_user_tezheng(isFromList ? joinUserId : result.creater, 2),
            get_user_tj(isFromList ? joinUserId : result.creater),
            get_sku_tezheng(id),
        ]);
        person_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });
        report_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });


        const isMycreated = result.creater == page_params.user_id
        const html = render_user_work_excep({
            detail: result,
            isMycreated,
            creater: user,
            quanzhong,
            person_tezheng,
            report_tezheng,
            tj,
            skuTezheng,
            isShowDetail,
            isFromList
        });

        $("#excep-detail").html(html);

        if(isFromList) {
            $("#user-work-order-modal-holder .join-members-right").removeClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-join-members-left");
            $("#user-work-order-modal-holder .subscriptions-header .third-left").attr("data-from-list", true);
            $("#user-work-order-modal-holder .subscriptions-header .third-left").attr("data-task-id", taskId);
        } else {
            $("#user-work-order-modal-holder .right").removeClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-left");
        }

        $("#user-work-order-modal-holder .excep-right").addClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-excep-left");
        browser_history.update("#user-work/excep/" + id);

        $(".third-left").attr("data-gongdan-id", id);

        $('.excep_title .user_profile_name').html('报告异常');
        if(isShowDetail) {
            const reportId = await get_excep_list(taskId);
            $('.excep_title .user_profile_name').html('查看异常');
            set_excep_form(reportId, isFromList);
        }
        hide_loading();
    }
}


async function set_pass_task(id, type, btn) {
    const {code, result} = await channel.post({
        url: `https://rpa.insfair.cn/zmtapi/gd/task/pass?id=${id}&status=${type}&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        // 隐藏审核按钮
        btn.closest('.join-member-item').find('.pass-material-btn').hide();
        btn.closest('.join-member-item').find('.nopass-material-btn').hide();
        btn.closest('.join-member-item').find('.help-report-material-button').hide();

        // 根据审核类型添加不同的元素
        if (type === 4) {
            // 审核不通过
            btn.closest('.join-member-item').find('.status-buttons').append(`
                <div class="status-text">审核不通过</div>
            `);
        } else if (type === 3) {
            // 审核通过
            btn.closest('.join-member-item').find('.status-buttons').append(`
                <button class="button small rounded feedback-material-btn">已审核 请反馈</button>
            `);
        }
    }
}

let membersPage = 1;
let membersTotal = 0;
const emptyMembersList = [{
    pid: '',
    img: '',
    author: '',
    shortDesc: '',
    title: ''
}];

let membersGongdanId = '';
let membersStatus = '';

async function show_join_members_section(id, status, isLoadMore) {
    show_loading();
    membersGongdanId = id;
    membersStatus = status;
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/user/list?page=${membersPage}&size=${pageSize}&id=${id}&status=${status}`,
    });
    $(".forth-left").attr("data-gongdan-id", id);
    if(code === 200) {
        result.list.forEach(item => {
            item.isMyReply = item.excep && (item.excep.user == page_params.user_id);
            item.urls.list.forEach(el => {
                el.created = moment(el.created).format("YYYY-MM-DD HH:mm:ss");
            });
            const myFeedback = item.feedbacks.list.find(el => el.user == page_params.user_id)
            item.isFeedback = item.status == 5 || myFeedback
        });
        const html = render_user_work_join_member_material_item({
            user_list: result.list,
            isAll: result.list.length === 0,
        });
        membersTotal = result.total;
        if(isLoadMore) {
            $("#join-member-list-all").append(html);
        } else {
            $("#join-member-list-all").html(html);
        }
        $("#user-work-order-modal-holder .right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-left");

        $(".join-members-sort-tab .ind-tab").attr("data-id", id);
        $("#user-work-order-modal-holder .join-members-right").addClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-join-members-left");
        browser_history.update("#user-work/members/" + id);
    }
    hide_loading();
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
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/detail?id=${id}&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        result.endTime = moment(result.endTime).format("YYYY-MM-DD HH:mm:ss");
        const user = people.get_by_user_id(parseInt(result.creater));
        const isOutOfTime = moment(result.endTime).valueOf() <= moment().valueOf();

        const [quanzhong, person_tezheng, report_tezheng, tj, skuTezheng] = await Promise.all([
            get_user_quanzhong(result.creater),
            get_user_tezheng(result.creater, 1),
            get_user_tezheng(result.creater, 2),
            get_user_tj(result.creater),
            get_sku_tezheng(id),
        ]);
        person_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });
        report_tezheng.forEach((item) => {
            item.isTop = parseInt(item.rank) <= 10;
        });


        const isMycreated = result.creater == page_params.user_id
        const html = render_user_work_detail({
            detail: result,
            isMycreated,
            creater: user,
            quanzhong,
            person_tezheng,
            report_tezheng,
            tj,
            skuTezheng,
            isOutOfTime
        });

        $("#user-work-detail").html(html);
        $(".join_members_title .user_profile_name").html(`全部参与 ${result.userCount}`);

        const detail = await get_work_stream_detail(result.workId);
        if (detail) {
            const $table = $("#stream-detail-steps-table tbody");
            $table.empty(); // 清空现有行

            detail.steps.forEach((step, index) => {
                $table.append(`
                    <tr>
                        <td>step ${step.indexs}</td>
                        <td>${step.title || ''}</td>
                        <td>${step.description || ''}</td>
                    </tr>
                `);
            });
        }

        if(isMycreated) {
            $('.join-count-down-box').countdown(result.endTime, function(event) {
                $(this).html(event.strftime(
                    `参与人提交截止剩余 &nbsp; %D:%H:%M:%S`
                ));
            }).on('finish.countdown', function() {
                $(this).html('提交已截止');
                $('.user-work-join-status').addClass('red').html('提交已截止');
            });

            const hasJoinMemeber = await get_gongdan_user_list_two(id);
            get_gongdan_tongji(id);
            if(hasJoinMemeber.length === 0) {
                $('.show-all-member-btn').hide();
            }
        } else {
            get_gongdan_user_list(id);
            get_my_join_status(id);
            const taskId = await get_my_join_info(id, result.endTime);
            if(taskId) {
                await get_my_url_list(taskId);
                const $materialHandler = $('.material-handler-content');
                $materialHandler.attr('data-gongdan-id', id);
                $materialHandler.attr('data-task-id', taskId);
            }
        }

        $("#user-work-order-modal-holder .right").addClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-left");

        browser_history.update("#user-work/" + id);
        hide_loading();
    }
}

async function set_work_stream_list() {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/zmt/fav/list?page=1&size=1000&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        const options = await result.list;

        // 生成select选项并插入
        const $select = $("#create-work-stream-select");
        $select.empty(); // 清空现有选项

        // 添加默认选项
        $select.append($("<option>", {
            value: "",
            text: "请选择工作流",
        }));

        // 循环添加options
        options.forEach((option) => {
            $select.append($("<option>", {
                value: option.id,
                text: option.title
            }));
        });
    } else {
        $select.append($("<option>", {
            value: "",
            text: "还没有收藏工作流",
        }));
    }
}

async function set_work_sku_list() {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/sku/list?page=1&size=1000&zulipUid=${page_params.user_id}`,
    });

    if (code === 200) {
        const options = await result.list;

        // 生成select选项并插入
        const $select = $("#create-work-sku-select");
        $select.empty(); // 清空现有选项

        // 添加默认选项
        $select.append($("<option>", {
            value: "",
            text: "请选择SKU",
        }));

        // 循环添加options
        options.forEach((option) => {
            $select.append($("<option>", {
                value: option.id,
                text: option.skuName
            }));
        });
    } else {
        const $select = $("#create-work-sku-select");
        $select.append($("<option>", {
            value: "",
            text: "暂未添加商品服务",
        }));
    }
}

function show_create_right_section() {
    $("#user-work-order-modal-holder .create-right").addClass("show");
    $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-create-left");
    browser_history.update("#user-work/new");

    set_work_stream_list();
    set_work_sku_list();

    $(".user-work-end-time-picker").flatpickr({
        altInput: false,
        allowInput: false,
        static: true,
        dateFormat: "Y-m-d H:i:S",
        altFormat: "Y-m-d H:i:S",
        enableTime: true,
        minDate: new Date().getTime(),
        time_24hr: true,
    });
}


export function change_state(section) {
    // if in #streams/new form.
    if (section === "new") {
        show_create_right_section();
        return;
    }

    if(section === "feedback" || section === "excep" || section === "members") {
        browser_history.update("#user-work");
        return;
    }

    // if the section is a valid number.
    if (/\d+/.test(section)) {
        const id = Number.parseInt(section, 10);
        // There are a few situations where we can't display stream settings:
        // 1. This is a stream that's been archived. (sub=undefined)
        // 2. The stream ID is invalid. (sub=undefined)
        // 3. The current user is a guest, and was unsubscribed from the stream
        //    stream in the current session. (In future sessions, the stream will
        //    not be in sub_store).
        //
        // In all these cases we redirect the user to 'subscribed' tab.
            // toggler.goto("subscribed");
            show_right_section(id);
            // switch_to_stream_row(stream_id);
        return;
    }
}

async function get_work_stream_detail(id) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/zmt/detail?id=${id}`,
    });

    if (code === 200) {
        // 可以根据需要处理返回的数据
        return result;
    }
    return null;
}

async function get_work_sku_detail(id) {
    const { code, result } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/sku/get?id=${id}`,
    });

    if (code === 200) {
        return result;
    }
    return null;
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

    $("body").on("change", "#create-work-stream-select", async function() {
        const selectedId = $(this).val();
        if (selectedId) {
            const detail = await get_work_stream_detail(selectedId);
            if (detail) {
                const $table = $(".stream-steps-box table tbody");
                $table.empty(); // 清空现有行

                if(detail.steps.length === 0) {
                    $(".stream-steps-box").hide();
                    return;
                }
                detail.steps.forEach((step, index) => {
                    $table.append(`
                        <tr>
                            <td>step ${step.indexs}</td>
                            <td>${step.title || ''}</td>
                            <td>${step.description || ''}</td>
                        </tr>
                    `);
                });

                $(".stream-steps-box").show();
            }
        } else {
            // 如果没有选中值，清空表格内容
            $(".stream-steps-box table tbody").empty();
        }
    });

    $("body").on("change", "#create-work-sku-select", async function() {
        const selectedId = $(this).val();
        if (selectedId) {
            const [detail, skuTezheng] = await Promise.all([
                get_work_sku_detail(selectedId),
                get_sku_tezheng(selectedId),
            ]);

            if (detail) {
                const html = render_user_work_sku_item({
                    sku: detail,
                    skuTezheng,
                });
                $("#sku-select-item-box").html(html);
            }
        } else {
            $("#sku-select-item-box").empty();
        }
    });

    $("body").on("click", "#create-user-work-btn", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const $form = $(".work-create-form");

        // 获取表单数据
        const workId = $("#create-work-stream-select").val();
        const skuId = $("#create-work-sku-select").val();
        const endTime = $(".user-work-end-time-picker").val();
        const money = $("#create-work-money-input").val();
        const description = $("#create-work-desc-input").val();

        // 清除之前的错误提示
        $form.find(".custom-field-status").empty().hide();

        // 表单验证
        if (!workId) {
            $form.find("#create-work-stream-select")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请选择工作流")
                .show();
            return;
        }

        if (!skuId) {
            $form.find("#create-work-sku-select")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请选择关联商品服务")
                .show();
            return;
        }

        if (!endTime) {
            $form.find(".user-work-end-time-picker")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请选择截止时间")
                .show();
            return;
        }

        if (money && !/^\d+(\.\d{1,2})?$/.test(money)) {
            $form.find("#create-work-money-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入正确的金额格式，最多支持两位小数")
                .show();
            return;
        }

        // 构造请求数据
        const data = {
            creater: page_params.user_id,
            description: description || "",
            endTime: moment(endTime).valueOf(),
            money: Number(money) || 0,
            skuId,
            workId
        };

        console.log(data);
        // 发送请求
        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gongdan/add",
            data: JSON.stringify(data),
            contentType: "application/json",
            success({code, result, message}) {
                // 显示成功提示
                if(code === 200) {
                    // 清空表单
                    $("#create-work-stream-select").val("");
                    $("#create-work-sku-select").val("");
                    $(".user-work-end-time-picker").val("");
                    $("#create-work-money-input").val("");
                    $("#create-work-desc-input").val("");
                    // 显示成功提示
                    dialog_widget.launch({
                        html_heading: $t_html({defaultMessage: "创建成功"}),
                        html_body: $t_html({defaultMessage: "工单已成功创建"}),
                        html_submit_button: $t_html({defaultMessage: "确定"}),
                        on_click: () => {
                            insert($("#compose-textarea")[0], `[新工单](/#user-work/${result})`);
                        },
                        close_on_escape: true,
                        single_footer_button: true,
                        help_link: "",
                    });
                } else {
                    $form.find("#create-work-stream-select")
                        .closest(".custom_user_field")
                        .find(".custom-field-status")
                        .addClass("alert-error")
                        .html("创建失败：" + message)
                        .show();
                    return;
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || $t({defaultMessage: "创建失败"});
                dialog_widget.launch({
                    html_heading: $t_html({defaultMessage: "创建失败"}),
                    html_body: error_message,
                    close_on_escape: true,
                    single_footer_button: true,
                });
            }
        });
    });

    $("body").on("click", ".join-button", async (e) => {
        const id = $(e.currentTarget).data('id');
        const endTime = $(e.currentTarget).data('end-time');

        const { code, result } = await channel.post({
            url: `https://rpa.insfair.cn/zmtapi/gongdan/accept?id=${id}&zulipUid=${page_params.user_id}`,
        });
        if(code === 200) {
            get_gongdan_user_list(id);
            get_my_join_info(id, endTime);
            const currentCount = parseInt($('.join-member-count').html()) || 0;
            $('.join-member-count').html(currentCount + 1);
            $('.show-report-button').hide();
            $('.material-handler-content').fadeIn(300);
            $(e.currentTarget).fadeOut(300);
        }
    });

    $("body").on("click", ".feedback-button", async (e) => {
        const id = $(e.currentTarget).data('id');
        show_feedback_section(id);
    })

    $("body").on("click", ".feedback-material-btn", async (e) => {
        const id = $(e.currentTarget).data('gongdan-id');
        const userId = $(e.currentTarget).data('user-id');
        const taskId = $(e.currentTarget).data('id');
        show_feedback_section(id, false, taskId, true, userId);
    })

    $("body").on("click", ".show-feedback-button", async (e) => {
        const id = $(e.currentTarget).data('id');
        const taskId = $(".material-handler-content").data('task-id');
        show_feedback_section(id, true, taskId);
    })

    $("body").on("click", ".show-feedback-material-btn", async (e) => {
        const id = $(e.currentTarget).data('gongdan-id');
        const userId = $(e.currentTarget).data('user-id');
        const taskId = $(e.currentTarget).data('id');
        show_feedback_section(id, true, taskId, true, userId);
    })

    $("body").on("click", ".add-new-material-input", (e) => {
        const $materialInput = $(`
            <div class="material-input-item">
                <input class="input material-input" placeholder="请输入链接URL">
                <a href="javascript:;" class="remove-material-input">删除</a>
            </div>
        `);

        $(e.currentTarget).closest('.material-handler-content').find('.material-input-box .material-input-item').last().after($materialInput);
    });

    $("body").on("click", ".remove-material-input", (e) => {
        $(e.currentTarget).closest('.material-input-item').remove();
    });

    $("body").on("click", ".submit-material-button", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const $inputs = $(e.currentTarget)
            .closest('.material-handler-content')
            .find('.material-input-box input');

        const urls = [];
        const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;

        let hasInvalidUrl = false;
        $inputs.each(function() {
            const value = $(this).val().trim();
            if (value) {
                if (!urlPattern.test(value)) {
                    $(this).addClass('invalid');
                    hasInvalidUrl = true;
                } else {
                    $(this).removeClass('invalid');
                    urls.push(value);
                }
            }
        });

        if (hasInvalidUrl) {
            ui_report.client_error(
                $t_html({defaultMessage: "请输入有效的URL链接"}),
                $('.material-submit-status'),
                1200,
            );
            return;
        }

        if (urls.length === 0) {
            ui_report.client_error(
                $t_html({defaultMessage: "请至少输入一个链接"}),
                $('.material-submit-status'),
                1200,
            );
            return;
        }

        const $button = $(e.currentTarget);
        const gongdanId = $button.closest('.material-handler-content').data('gongdan-id');
        const taskId = $button.closest('.material-handler-content').data('task-id');

        // 构造请求数据
        const data = {
            gongdanId,
            taskId,
            urlSet: urls,
            user: page_params.user_id
        };

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/url/add",
            data: JSON.stringify(data),
            contentType: "application/json",
            success({code, message}) {
                if(code === 200) {
                    ui_report.success(
                        $t_html({defaultMessage: "提交成功"}),
                        $('.material-submit-status'),
                        1200,
                    );
                    const newUrlItems = urls.map(url => `
                        <div class="material-url-item">
                            <a href="${url}" target="_blank">${url}</a>
                        </div>
                    `).join('');
                    $(".material-url-box").append(newUrlItems);
                    // 清空输入框
                    $inputs.val('');
                } else {
                    ui_report.client_error(
                        `提交失败:${message}`,
                        $('.material-submit-status'),
                        1200,
                    );
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.material-submit-status'),
                    1200,
                );
            }
        });

    });

    $("body").on("click", ".help-submit-material-button", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const $inputs = $(e.currentTarget)
            .closest('.material-handler-content')
            .find('.material-input-box input');

        const urls = [];
        const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;

        let hasInvalidUrl = false;
        $inputs.each(function() {
            const value = $(this).val().trim();
            if (value) {
                if (!urlPattern.test(value)) {
                    $(this).addClass('invalid');
                    hasInvalidUrl = true;
                } else {
                    $(this).removeClass('invalid');
                    urls.push(value);
                }
            }
        });

        if (hasInvalidUrl) {
            ui_report.client_error(
                $t_html({defaultMessage: "请输入有效的URL链接"}),
                $('.help-submit-form .material-submit-status'),
                1200,
            );
            return;
        }

        if (urls.length === 0) {
            ui_report.client_error(
                $t_html({defaultMessage: "请至少输入一个链接"}),
                $('.help-submit-form .material-submit-status'),
                1200,
            );
            return;
        }

        const $button = $(e.currentTarget);
        const gongdanId = $button.data('gongdan-id');
        const taskId = $button.data('task-id');

        // 构造请求数据
        const data = {
            gongdanId,
            taskId,
            urlSet: urls,
            user: page_params.user_id
        };

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/url/add",
            data: JSON.stringify(data),
            contentType: "application/json",
            success({code, message}) {
                if(code === 200) {
                    ui_report.success(
                        $t_html({defaultMessage: "提交成功"}),
                        $('.help-submit-form .material-submit-status'),
                        1200,
                    );
                    const newUrlItems = urls.map(url => `
                        <div class="list-item">
                            <div class="create-time">
                                创建人于 ${moment().format('YYYY-MM-DD HH:mm:ss')}
                            </div>
                            <div class="material-url-item">
                                <a href="${url}" target="_blank">${url}</a>
                            </div>
                        </div>
                    `).join('');

                    $(e.currentTarget).closest('.join-member-item').find(".no-material-text").hide();
                    $(e.currentTarget).closest('.join-member-item').find(".material-url-box").prepend(newUrlItems);
                    // 清空输入框
                    $inputs.val('');
                    $(e.currentTarget).closest('.join-member-item').find('.help-submit-form').slideUp();
                } else {
                    ui_report.client_error(
                        `提交失败:${message}`,
                        $('.help-submit-form .material-submit-status'),
                        1200,
                    );
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.help-submit-form .material-submit-status'),
                    1200,
                );
            }
        });

    });

    $("body").on("click", ".reply-excep-material-button", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const $item = $(e.currentTarget).closest('.join-member-item');
        const excepId = $(e.currentTarget).data('excep-id');
        const message = $item.find('.reply-excep-material-message').val().trim();

        if (!message) {
            $item.find('.reply-excep-material-message')
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入回复内容")
                .show();
            return;
        }

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/exception/deal",
            data: JSON.stringify({
                id: excepId,
                message: message,
                uid: page_params.user_id
            }),
            contentType: "application/json",
            success({code, result}) {
                if(code === 200) {
                    // 禁用输入框
                    $item.find('.reply-excep-material-message').prop('readonly', true);
                    // 隐藏提交按钮
                    $(e.currentTarget).hide();
                    // 隐藏回复表单
                    $item.find('.reply-excep-form').slideUp();
                    // 在父级添加等待确认文字
                    $(e.currentTarget)
                        .closest(".custom_user_field")
                        .append('<div class="waiting-confirm">已回复，等待报告方确认解决</div>');
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.excep-submit-status'),
                    1200,
                );
            }
        });
    });


    $('body').on('click', '.report-material-button', (e) => {
        const id = $(e.currentTarget).data('id');
        show_excep_section(id);
    })

    $('body').on('click', '.help-report-material-button', (e) => {
        const gongdanId = $(e.currentTarget).data('gongdan-id');
        const taskId = $(e.currentTarget).data('task-id');
        const userId = $(e.currentTarget).data('user-id');
        show_excep_section(gongdanId, false, taskId, '', true, userId);
    })

    $('body').on('click', '.help-add-new-material-input', (e) => {
        $(e.currentTarget).closest('.join-member-item').find('.help-submit-form').slideDown();
    })

    $('body').on('click', '.handle-reply-show-btn', (e) => {
        const endTime = $(e.currentTarget).data('end-time');
        if(moment().valueOf() > endTime) {
            $(e.currentTarget).closest('.join-member-item').find('.material-input-box').hide();
            $(e.currentTarget).closest('.join-member-item').find('.add-new-btn-box').hide();
            $(e.currentTarget).closest('.join-member-item').find('.material-list-excep-reply-box').html("已超出回复时间");
        } else {
            $(e.currentTarget).closest('.join-member-item').find('.material-list-excep-reply-time').countdown(moment(endTime).format('YYYY-MM-DD HH:mm:ss'), function(event) {
                $(this).html(event.strftime(
                    `%D:%H:%M:%S`
                ));
            }).on('finish.countdown', function() {
                $(this).closest('.join-member-item').find('.material-list-excep-reply-box').html("已超出回复时间");
                $(e.currentTarget).closest('.join-member-item').find('.material-input-box').hide();
                $(e.currentTarget).closest('.join-member-item').find('.add-new-btn-box').hide();
            });
        }
        $(e.currentTarget).closest('.join-member-item').find('.reply-excep-form').slideDown();
    })


    $("body").on("click", ".show-report-button", async (e) => {
        const id = $(e.currentTarget).data('id');
        const taskId = $(".material-handler-content").data('task-id');
        const statusException = $(e.currentTarget).data('excep-status');
        show_excep_section(id, true, taskId, statusException);
    })

    $("body").on("click", ".pass-material-btn", async (e) => {
        const taskId = $(e.currentTarget).data('task-id');
        set_pass_task(taskId, 3, $(e.currentTarget));
    })

    $("body").on("click", ".nopass-material-btn", async (e) => {
        const taskId = $(e.currentTarget).data('task-id');
        set_pass_task(taskId, 4, $(e.currentTarget));
    })


    $("body").on("click", ".help-show-report-button", async (e) => {
        const gongdanId = $(e.currentTarget).data('gongdan-id');
        const taskId = $(e.currentTarget).data('task-id');
        const statusException = $(e.currentTarget).data('excep-status');
        const userId = $(e.currentTarget).data('user-id');
        show_excep_section(gongdanId, true, taskId, statusException, true, userId);
    })


    $('body').on('click', '#show-all-join-btn', (e) => {
        const id = $(e.currentTarget).data('id');
        membersPage = 1;
        show_join_members_section(id, 2);
        $(".join-members-sort-tab .ind-tab").each(function() {
            if ($(this).data('tab-id') === 2) {
                $(".join-members-sort-tab .ind-tab").removeClass("selected");
                $(this).addClass("selected");
            }
        });
    })

    $("body").on("click", ".join-members-sort-tab .ind-tab", (e) => {
        const tabId = $(e.currentTarget).data("tab-id");
        const id = $(e.currentTarget).data("id");
        $(".join-members-sort-tab .ind-tab").removeClass("selected");
        $(e.currentTarget).addClass("selected");
        membersPage = 1;
        show_join_members_section(id, tabId == 0 ? '' : tabId);
    })

    $('body').on('click', '.feedback-tag', (e) => {
        if($(e.currentTarget).closest('.readonly-tag').length) return;
        $(e.currentTarget).toggleClass('selected');
    });

    $('body').on('click', '.excep-tag', (e) => {
        if($(e.currentTarget).closest('.readonly-tag').length) return;

        $('.excep-tag').removeClass('selected');
        $(e.currentTarget).addClass('selected');
    });

    $("body").on("click", "#submit-feedback-btn", (e) => {
        e.stopPropagation();
        e.preventDefault();

        let createrTags = [];
        let skuTags = [];
        $('.feedback-tag.selected').each(function() {
            if($(this).data('type') === 'creater') {
                createrTags.push($(this).data('value'));
            } else {
                skuTags.push($(this).data('value'));
            }
        });

        const url = $("#feedback-url-input").val().trim();
        const money = $("#feedback-money-input").val().trim();
        const gongdanId = $('.second-left').data('gongdan-id');
        const taskId = $('.material-handler-content').data('task-id') || $(e.currentTarget).data('task-id');

        // if (createrTags.length === 0 && skuTags.length === 0) {
        //     $(".feedback-tags-box")
        //         .closest(".custom_user_field")
        //         .find(".custom-field-status")
        //         .addClass("alert-error")
        //         .html("请至少选择一个特征")
        //         .show();
        //     return;
        // }

        if (!url) {
            $("#feedback-url-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入反馈内容")
                .show();
            return;
        }

        if (money && !/^\d+(\.\d{1,2})?$/.test(money)) {
            $("#feedback-money-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入正确的金额格式，最多支持两位小数")
                .show();
            return;
        }

        const data = {
            cate: createrTags.join(','),
            cateGood: skuTags.join(','),
            gongdanId,
            money: Number(money) || 0,
            taskId,
            url,
            user: page_params.user_id
        };

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/feedback/add",
            data: JSON.stringify(data),
            contentType: "application/json",
            success({code, message}) {
                if(code === 200) {
                    ui_report.success(
                        "提交成功",
                        $('.feedback-submit-status'),
                        1200,
                    );
                    setTimeout(() => {
                        $('.second-left').trigger('click');
                    }, 1000);
                } else {
                    ui_report.client_error(
                        `提交失败:${message}`,
                        $('.feedback-submit-status'),
                        1200,
                    );
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.feedback-submit-status'),
                    1200,
                );
            }
        });
    });

    $("body").on("click", "#submit-excep-btn", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const url = $("#excep-url-input").val().trim();
        const money = $("#excep-money-input").val().trim();
        const gongdanId = $('.second-left').data('gongdan-id') || $('.third-left').data('gongdan-id');
        const taskId = $('.material-handler-content').data('task-id') || $('.third-left').data('task-id');
        const selectedType = $('.excep-tag.selected').data('value');

        if (!selectedType) {
            $(".excep-tags-box")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请选择异常类型")
                .show();
            return;
        }

        if (!url) {
            $("#excep-url-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入异常说明")
                .show();
            return;
        }

        if (money && !/^\d+(\.\d{1,2})?$/.test(money)) {
            $("#excep-money-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入正确的金额格式，最多支持两位小数")
                .show();
            return;
        }

        const data = {
            gongdanId,
            money: Number(money) || 0,
            taskId,
            typeExcep: Number(selectedType),
            url,
            user: page_params.user_id
        };

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/exception/add",
            data: JSON.stringify(data),
            contentType: "application/json",
            success({code, message}) {
                if(code === 200) {
                    ui_report.success(
                        "提交成功",
                        $('.excep-submit-status'),
                        1200,
                    );
                    setTimeout(() => {
                        $('.third-left').trigger('click');
                    }, 1000);
                } else {
                    ui_report.client_error(
                        `提交失败:${message}`,
                        $('.excep-submit-status'),
                        1200,
                    );
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.excep-submit-status'),
                    1200,
                );
            }
        });
    });

    $("body").on("click", "#submit-reply-excep-btn", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const excepId = $(e.currentTarget).data('excep-id');
        const message = $("#reply-excep-url-input").val().trim();

        if (!message) {
            $("#reply-excep-url-input")
                .closest(".custom_user_field")
                .find(".custom-field-status")
                .addClass("alert-error")
                .html("请输入回复内容")
                .show();
            return;
        }

        channel.post({
            url: "https://rpa.insfair.cn/zmtapi/gd/exception/deal",
            data: JSON.stringify({
                id: excepId,
                message: message,
                uid: page_params.user_id
            }),
            contentType: "application/json",
            success({code, result}) {
                if(code === 200) {
                    // 禁用输入框
                    $("#reply-excep-url-input").prop('readonly', true);
                    // 隐藏提交按钮
                    $(e.currentTarget).hide();
                    // 在父级添加等待确认文字
                    $(e.currentTarget)
                        .closest(".custom_user_field")
                        .append('<div class="waiting-confirm">已回复，等待报告方确认解决</div>');

                    // 更新状态显示
                    $('.excep_no_reply_creater .status_title').text('您已提供异常情况说明');
                    $('.excep_no_reply_creater .status_label').hide();
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "提交失败";
                ui_report.client_error(
                    `提交失败:${error_message}`,
                    $('.excep-submit-status'),
                    1200,
                );
            }
        });
    });

    $("body").on("click", "#excep_close_btn", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const excepId = $(e.currentTarget).data('excep-id');
        const isFromList = $(e.currentTarget).data('from-list');

        channel.post({
            url: `https://rpa.insfair.cn/zmtapi/gd/exception/close?id=${excepId}&status=3&zulipUid=${page_params.user_id}`,
            success({code, message}) {
                if(code === 200) {
                    $('.excep_status_buttons').html('你选择了双方已解决此异常');
                }
            },
            error(xhr) {
                const error_message = xhr.responseJSON?.message || "关闭失败";
                ui_report.client_error(
                    `关闭失败:${error_message}`,
                    $('.excep-submit-status'),
                    1200,
                );
            }
        });
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

    $("body").on("click", "#user-work-order-modal .work-item .button", (e) => {
        const id = $(e.currentTarget).data('id');
        show_right_section(id);
    });

    $("#user-work-order-modal-holder").on("click", ".first-left", () => {
        $("#user-work-order-modal-holder .right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-left");

        $("#user-work-order-modal-holder .create-right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-create-left");

        browser_history.update("#user-work");
    });

    $("#user-work-order-modal-holder").on("click", ".second-left", (e) => {
        const id = $(e.currentTarget).data('gongdan-id');
        const isFromList = $(e.currentTarget).data('from-list');
        $("#user-work-order-modal-holder .feedback-right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-feedback-left");

        if(isFromList) {
            $("#user-work-order-modal-holder .join-members-right").addClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-join-members-left");
            browser_history.update("#user-work/members/" + id);
        } else {
            get_my_join_status(id);
            $("#user-work-order-modal-holder .right").addClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-left");
            browser_history.update("#user-work/" + id);
        }
    });

    $("#user-work-order-modal-holder").on("click", ".third-left", (e) => {
        const id = $(e.currentTarget).data('gongdan-id');
        const isFromList = $(e.currentTarget).data('from-list');
        get_my_join_status(id);
        $("#user-work-order-modal-holder .excep-right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-excep-left");

        if(isFromList) {
            // show_join_members_section(id, 2);
            $("#user-work-order-modal-holder .join-members-right").addClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-join-members-left");
            browser_history.update("#user-work/members/" + id);
        } else {
            $("#user-work-order-modal-holder .right").addClass("show");
            $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-left");
            browser_history.update("#user-work/" + id);
        }
    });

    $("#user-work-order-modal-holder").on("click", ".forth-left", (e) => {
        const id = $(e.currentTarget).data('gongdan-id');
        // get_my_join_status(id);
        $("#user-work-order-modal-holder .join-members-right").removeClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").removeClass("slide-join-members-left");

        $("#user-work-order-modal-holder .right").addClass("show");
        $("#user-work-order-modal-holder .subscriptions-header").addClass("slide-left");

        browser_history.update("#user-work/" + id);
    });
}

let allWorkPage = 1;
let allWorkTotal = 0;
const pageSize = 10;
const emptyList = [{
    pid: '',
    img: '',
    author: '',
    shortDesc: '',
    title: ''
}];

export function calculateTotalPages(totalItems, itemsPerPage) {
    return Math.ceil(totalItems / itemsPerPage);
}

export function show_loading() {
    const $spinner = $('#user-work-order-modal').find(".sub_unsub_status").expectOne();
    $spinner.show();
    loading.make_indicator($spinner);
}

export function hide_loading() {
    const $spinner = $('#user-work-order-modal').find(".sub_unsub_status").expectOne();
    $spinner.hide();
    loading.destroy_indicator($spinner);
}


async function render_all_work_order_list(isReload) {
    show_loading();
    const { code, result: { list , pages, total} } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/list?page=${allWorkPage}&size=${pageSize}&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        list.forEach((item) => {
            item.endTime = item.endTime ? moment(item.endTime).format('YYYY-MM-DD HH:mm:ss') : '';
        });
        const html = render_user_work_item({
            workList: list.length === 0 ? emptyList : list,
            isAll: list.length === 0
        });

        allWorkTotal = total;

        if(isReload) {
            scroll_util.get_content_element($("#all-work-tab .work-list")).html(html);
        } else {
            scroll_util.get_content_element($("#all-work-tab .work-list")).append(html);
        }

        hide_loading();
    }
}

let myWorkPage = 1;
let myWorkTotal = 0;

async function render_my_work_order_list(isReload) {
    show_loading();
    const { code, result: { list , pages, total} } = await channel.get({
        url: `https://rpa.insfair.cn/zmtapi/gongdan/list/self?page=${myWorkPage}&size=${pageSize}&type=1&zulipUid=${page_params.user_id}`,
    });

    if(code === 200) {
        list.forEach((item) => {
            item.endTime = item.endTime ? moment(item.endTime).format('YYYY-MM-DD HH:mm:ss') : '';
        });
        const html = render_user_work_item({
            workList: list.length === 0 ? emptyList : list,
            isAll: list.length === 0
        });

        myWorkTotal = total;

        if(isReload) {
            scroll_util.get_content_element($("#my-work-tab .work-list")).html(html);
        } else {
            scroll_util.get_content_element($("#my-work-tab .work-list")).append(html);
        }

        hide_loading();
    }
}

export async function show_user_work_order(default_tab_key = "all-work-tab", section) {
    popovers.hide_all();

    const args = {
        user_avatar: page_params.avatar_url,
    }

    $("#user-work-order-modal-holder").html(render_user_work_order_modal(args));
    $(".tabcontent").hide();
    overlays.open_modal("user-work-order-modal", {autoremove: true, on_hide() { browser_history.exit_overlay() }});

    let default_tab = 0;
    // Only checking this tab key as currently we only open this tab directly
    // other than profile-tab.
    if (default_tab_key === "my-work-tab") {
        default_tab = 1;
    }

    change_state(section);

    const opts = {
        selected: default_tab,
        child_wants_focus: true,
        values: [
            {label: '全部', key: "all-work-tab"},
            {label: '我发起的', key: "my-work-tab"},
        ],
        callback(name, key) {
            $(".tabcontent").hide();
            $(`#${CSS.escape(key)}`).show();
            switch (key) {
                case "all-work-tab":
                    if (!$("#all-work-tab .work-list").children().length) {
                        allWorkPage = 1;
                        render_all_work_order_list(true);
                    }
                    break;
                case "my-work-tab":
                    if (!$("#my-work-tab .work-list").children().length) {
                        myWorkPage = 1;
                        render_my_work_order_list(true);
                    }
                    break;
            }
        },
    };

    const $elem = components.toggle(opts).get();
    $elem.addClass("large allow-overflow");
    $("#tab-toggle").append($elem);

    scroll_util.on_scroll_to_bottom($("#all-work-tab .work-list"), () => {
        if (allWorkPage <= calculateTotalPages(allWorkTotal, pageSize)) {
            allWorkPage ++;
            render_all_work_order_list();
        }
    })

    scroll_util.on_scroll_to_bottom($("#my-work-tab .work-list"), () => {
        if (myWorkPage <= calculateTotalPages(myWorkTotal, pageSize)) {
            myWorkPage ++;
            render_my_work_order_list();
        }
    })

    scroll_util.on_scroll_to_bottom($(".join-members-right"), () => {
        if (membersPage <= calculateTotalPages(membersTotal, pageSize)) {
            membersPage ++;
            show_join_members_section(membersGongdanId, membersStatus, true);
        }
    })
}
