using Valour.Client.Components.DockWindows;
using Valour.Client.Components.Windows.CallWindows;
using Valour.Shared.Models;
using Channel = Valour.Sdk.Models.Channel;

namespace Valour.Client.Components.Windows.ChannelWindows;

public static class ChannelWindowFactory
{
    /// <summary>
    /// The focused tab when it is showing a channel, so channel navigation can
    /// replace the current view instead of stacking a new tab.
    /// </summary>
    public static WindowTab FocusedChannelTab
    {
        get
        {
            var tab = WindowService.FocusedTab;
            var type = tab?.Content?.ComponentType;

            if (type == typeof(ChatWindowComponent) || type == typeof(CallWindowComponent))
                return tab;

            return null;
        }
    }

    public static async Task<WindowContent?> GetDefaultContent(Channel channel)
    {
        if (ISharedChannel.ChatChannelTypes.Contains(channel.ChannelType))
            return await ChatWindowComponent.GetDefaultContent(channel);

        if (ISharedChannel.VoiceChannelTypes.Contains(channel.ChannelType))
            return await CallWindowComponent.GetDefaultContent(channel);

        return null;
    }
}
