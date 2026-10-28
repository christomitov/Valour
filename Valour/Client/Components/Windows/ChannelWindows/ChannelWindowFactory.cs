using Valour.Client.Components.DockWindows;
using Valour.Client.Components.Windows.CallWindows;
using Valour.Shared.Models;
using Channel = Valour.Sdk.Models.Channel;

namespace Valour.Client.Components.Windows.ChannelWindows;

public static class ChannelWindowFactory
{
    public static async Task<WindowContent?> GetDefaultContent(Channel channel)
    {
        if (ISharedChannel.ChatChannelTypes.Contains(channel.ChannelType))
            return await ChatWindowComponent.GetDefaultContent(channel);

        if (ISharedChannel.VoiceChannelTypes.Contains(channel.ChannelType))
            return await CallWindowComponent.GetDefaultContent(channel);

        return null;
    }
}
